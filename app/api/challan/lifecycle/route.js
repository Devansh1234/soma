import { NextResponse } from 'next/server';
import { getCurrentUser, getEffectivePermissions } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { getCompany } from '@/lib/companies';
import { sendSystemEmail, buildItemsTable, emailWrapper } from '@/lib/email';

// Parse "Name [LNCODE] (Rs.Price x Qty)" or legacy "Name (Rs.Price x Qty)"
function parseProductsString(str) {
  if (!str) return [];
  return str.split('; ').map(item => {
    const m = item.match(/^(.+?)(?:\s+\[([A-Z0-9]+)\])?\s+\(Rs\.([\d,]+\.?\d*)\s+x\s+(\d+)\)$/);
    if (m) return { name: m[1], ln_code: m[2] || null, price: parseFloat(m[3].replace(/,/g,'')), quantity: parseInt(m[4]) };
    return { name: item.replace(/\s+\(Rs\..*$/, ''), ln_code: null, price: 0, quantity: 1 };
  }).filter(p => p.name.trim());
}

// Auto-update order_items when a challan is RTC'd
async function autoDeliverOrderItems(challan, companyId) {
  const customerName = challan['Customer Name'];
  const challanNumber = challan['Challan Number'];
  const billNo = challan.invoice_reference || '';
  const products = parseProductsString(challan['Products']);

  for (const product of products) {
    if (!product.ln_code && !product.name) continue;

    // Find matching pending_delivery order_items for this customer
    let query = supabase.from('order_items')
      .select('*')
      .eq('company', companyId)
      .eq('retailer_name', customerName)
      .eq('status', 'pending_delivery');

    // Match by LN code if available, else by product name (case-insensitive)
    if (product.ln_code) {
      query = query.eq('ln_code', product.ln_code);
    } else {
      query = query.ilike('product_name', `%${product.name.substring(0, 15)}%`);
    }

    const { data: matchingItems } = await query.order('created_at', { ascending: true });
    if (!matchingItems?.length) continue;

    let remainingQty = product.quantity;

    for (const item of matchingItems) {
      if (remainingQty <= 0) break;
      const stillNeeded  = item.ordered_qty - item.delivered_qty;
      if (stillNeeded <= 0) continue;
      const delivering   = Math.min(remainingQty, stillNeeded);
      const newDelivered = item.delivered_qty + delivering;
      const fullyDone    = newDelivered >= item.ordered_qty;
      remainingQty -= delivering;

      await supabase.from('order_items').update({
        delivered_qty: newDelivered,
        status:        fullyDone ? 'delivered' : 'pending_delivery',
        challan_refs:  [...(item.challan_refs || []), challanNumber],
        bill_numbers:  billNo ? [...(item.bill_numbers || []), billNo] : item.bill_numbers,
        delivered_at:  fullyDone ? new Date().toISOString() : null,
      }).eq('id', item.id);
    }
  }

  // Update order status: if ALL items delivered → order = delivered
  // Find all affected orders for this customer
  const { data: customerItems } = await supabase
    .from('order_items')
    .select('order_id, status')
    .eq('company', companyId)
    .eq('retailer_name', customerName)
    .neq('status', 'cancelled');

  const orderIds = [...new Set((customerItems || []).map(i => i.order_id))];
  for (const oid of orderIds) {
    const items = customerItems.filter(i => i.order_id === oid);
    const allDone = items.every(i => i.status === 'delivered');
    if (allDone) {
      await supabase.from('orders').update({ status: 'delivered', updated_at: new Date().toISOString() }).eq('id', oid);
    }
  }
}

export async function POST(request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { challanNumber, action, invoiceReference } = await request.json();
  if (!challanNumber || !action) {
    return NextResponse.json({ error: 'challanNumber and action required' }, { status: 400 });
  }

  const perms = getEffectivePermissions(user);

  // ── RTC ───────────────────────────────────────────────────────────────────
  if (action === 'rtc') {
    if (!perms.rtc_challan) return NextResponse.json({ error: 'Not authorised to mark RTC' }, { status: 403 });

    const { data: challan } = await supabase
      .from('ChallanRecords').select('*').eq('Challan Number', challanNumber).maybeSingle();
    if (!challan) return NextResponse.json({ error: 'Challan not found' }, { status: 404 });
    if (challan.status === 'rtc')       return NextResponse.json({ error: 'Already RTC' }, { status: 400 });
    if (challan.status === 'cancelled') return NextResponse.json({ error: 'Cannot RTC cancelled challan' }, { status: 400 });

    await supabase.from('ChallanRecords').update({ status: 'rtc' }).eq('Challan Number', challanNumber);

    // Derive company from challan number prefix (needed for inventory queries)
    const prefix = challanNumber.split('/')[0];
    const cMap   = { SCC: 'soma', NCC: 'nalanda', GEC: 'gangotri' };
    const compId = cMap[prefix] || user.company;

    // ── Dispatch committed items (linked at challan creation) ──────────────
    const linkedIds     = Array.isArray(challan.linked_inventory_ids) ? challan.linked_inventory_ids : [];
    const invWarnings   = [];

    if (linkedIds.length) {
      // Fetch product_codes of committed items so we can calculate shortfalls
      const { data: committedItems } = await supabase
        .from('inventory').select('id, product_code').in('id', linkedIds);
      const committedByLN = {};
      for (const row of (committedItems || [])) {
        committedByLN[row.product_code] = (committedByLN[row.product_code] || 0) + 1;
      }
      await supabase.from('inventory').update({ status: 'dispatched' }).in('id', linkedIds);

      // Calculate shortfalls: requested qty vs committed qty per LN code
      const rtcProducts = parseProductsString(challan['Products']);
      const pad = n => String(n).padStart(2,'0');
      const d   = new Date();
      const today = `${pad(d.getDate())}-${pad(d.getMonth()+1)}-${d.getFullYear()}`;
      for (const product of rtcProducts) {
        if (!product.ln_code) continue;
        const committed = committedByLN[product.ln_code] || 0;
        const shortfall = product.quantity - committed;
        if (shortfall > 0) {
          // Record shortfall as negative inventory row for tracking
          await supabase.from('inventory').insert({
            product_code:    product.ln_code,
            product_name:    product.name,
            quantity:        -shortfall,
            status:          'shortfall',
            company:         compId,
            input_date:      today,
            pending_receipt: false,
            not_received:    false,
            type_of_entry:   'shortfall',
            invoice_number:  challanNumber,
          });
          invWarnings.push(`${product.ln_code}: needed ${product.quantity}, dispatched ${committed} (${shortfall} short — recorded as negative inventory)`);
        }
      }
    } else {
      // Legacy challan: no linked IDs — do FIFO search now and record shortfalls
      const rtcProducts = parseProductsString(challan['Products']);
      const pad = n => String(n).padStart(2,'0');
      const d   = new Date();
      const today = `${pad(d.getDate())}-${pad(d.getMonth()+1)}-${d.getFullYear()}`;
      for (const product of rtcProducts) {
        if (!product.ln_code) continue;
        const { data: freeItems } = await supabase
          .from('inventory').select('id')
          .eq('company', compId).eq('status', 'free')
          .eq('product_code', product.ln_code).eq('pending_receipt', false)
          .order('created_at', { ascending: true }).limit(product.quantity);
        const available = freeItems?.length || 0;
        if (available > 0) {
          await supabase.from('inventory').update({ status: 'dispatched' }).in('id', freeItems.map(i => i.id));
        }
        if (available < product.quantity) {
          const shortfall = product.quantity - available;
          await supabase.from('inventory').insert({
            product_code:    product.ln_code,
            product_name:    product.name,
            quantity:        -shortfall,
            status:          'shortfall',
            company:         compId,
            input_date:      today,
            pending_receipt: false,
            not_received:    false,
            type_of_entry:   'shortfall',
            invoice_number:  challanNumber,
          });
          invWarnings.push(`${product.ln_code}: needed ${product.quantity}, dispatched ${available} (${shortfall} short)`);
        }
      }
    }

    // Auto-deliver matching order items
    await autoDeliverOrderItems(challan, compId);

    // RTC email
    const company = getCompany(compId);
    if (company?.defaultEmail) {
      const products = parseProductsString(challan['Products']);
      const total    = products.reduce((s,p) => s + p.price * p.quantity, 0);
      const tableHtml = buildItemsTable(
        ['Product', 'Qty', 'Unit Price (₹)', 'Total (₹)'],
        products.map(p => [
          'Godrej ' + p.name,
          p.quantity,
          p.price.toLocaleString('en-IN', { minimumFractionDigits:2 }),
          (p.price*p.quantity).toLocaleString('en-IN', { minimumFractionDigits:2 }),
        ])
      );
      await sendSystemEmail({
        companyEmail: company.defaultEmail,
        companyName:  company.name,
        subject: `Challan Released — ${challanNumber} — ${challan['Customer Name']}${invWarnings.length ? ' ⚠ Stock Shortfall' : ''}`,
        htmlBody: emailWrapper({
          companyName: company.name,
          title:       'Challan Released to Customer',
          meta: {
            'Challan No':    challanNumber,
            'Customer':      challan['Customer Name'],
            'Order Ref':     challan['Order Reference'] || '—',
            'Invoice No':    challan.invoice_reference || '—',
            'CCID':          challan.ccid || '—',
            'Marked RTC by': user.name,
            'Timestamp':     new Date().toLocaleString('en-IN'),
            'Total Value':   `₹${total.toLocaleString('en-IN', { minimumFractionDigits:2 })}`,
            ...(invWarnings.length ? { '⚠ Stock Shortfall': invWarnings.join(' | ') } : {}),
          },
          tableHtml,
          footer: 'Automated notification from Challan & Warehouse System',
        }),
      });
    }
    return NextResponse.json({ ok: true });
  }

  // ── CANCEL ─────────────────────────────────────────────────────────────────
  if (action === 'cancel') {
    if (!perms.cancel_challan) return NextResponse.json({ error: 'Not authorised' }, { status: 403 });
    const { data: challan } = await supabase
      .from('ChallanRecords').select('*').eq('Challan Number', challanNumber).maybeSingle();
    if (!challan) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (challan.status === 'cancelled') return NextResponse.json({ error: 'Already cancelled' }, { status: 400 });

    await supabase.from('ChallanRecords')
      .update({ status: 'cancelled', linked_inventory_ids: [] })
      .eq('Challan Number', challanNumber);

    // Revert committed inventory items back to free
    const ids = challan.linked_inventory_ids;
    if (Array.isArray(ids) && ids.length) {
      await supabase.from('inventory').update({ status: 'free' }).in('id', ids);
    }

    // Send cancellation email
    const prefix  = challanNumber.split('/')[0];
    const cMap    = { SCC: 'soma', NCC: 'nalanda', GEC: 'gangotri' };
    const compId  = cMap[prefix] || user.company;
    const company = getCompany(compId);
    if (company?.defaultEmail) {
      const products  = parseProductsString(challan['Products']);
      const tableHtml = buildItemsTable(
        ['Product', 'LN Code', 'Qty', 'Price (₹)'],
        products.map(p => [
          'Godrej ' + p.name,
          p.ln_code || '—',
          p.quantity,
          p.price.toLocaleString('en-IN', { minimumFractionDigits:2 }),
        ])
      );
      await sendSystemEmail({
        companyEmail: company.defaultEmail,
        companyName:  company.name,
        subject: `Challan Cancelled — ${challanNumber} — ${challan['Customer Name']}`,
        htmlBody: emailWrapper({
          companyName: company.name,
          title:       'Challan Cancelled',
          meta: {
            'Challan No':    challanNumber,
            'Customer':      challan['Customer Name'] || '—',
            'Order Ref':     challan['Order Reference'] || '—',
            'Challan Date':  challan['Challan Date'] || '—',
            'Cancelled by':  user.name,
            'Timestamp':     new Date().toLocaleString('en-IN'),
            ...(ids?.length ? { 'Inventory reverted': `${ids.length} item(s) returned to free stock` } : {}),
          },
          tableHtml,
          footer: 'Automated notification from Challan & Warehouse System',
        }),
      });
    }
    return NextResponse.json({ ok: true });
  }

  // ── ADD INVOICE ─────────────────────────────────────────────────────────────
  if (action === 'add_invoice') {
    if (!invoiceReference?.trim()) return NextResponse.json({ error: 'Invoice reference required' }, { status: 400 });
    await supabase.from('ChallanRecords').update({ invoice_reference: invoiceReference.trim() }).eq('Challan Number', challanNumber);
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
}
