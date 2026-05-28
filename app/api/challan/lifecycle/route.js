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

    // Dispatch linked inventory items
    const ids = challan.linked_inventory_ids;
    if (Array.isArray(ids) && ids.length) {
      await supabase.from('inventory').update({ status: 'dispatched' }).in('id', ids);
    }

    // Auto-deliver matching order items
    const prefix = challanNumber.split('/')[0];
    const cMap   = { SCC: 'soma', NCC: 'nalanda', GEC: 'gangotri' };
    const compId = cMap[prefix] || user.company;
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
        subject: `Challan Released — ${challanNumber} — ${challan['Customer Name']}`,
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
      .from('ChallanRecords').select('status, linked_inventory_ids').eq('Challan Number', challanNumber).maybeSingle();
    if (!challan) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (challan.status === 'cancelled') return NextResponse.json({ error: 'Already cancelled' }, { status: 400 });
    await supabase.from('ChallanRecords').update({ status: 'cancelled' }).eq('Challan Number', challanNumber);
    const ids = challan.linked_inventory_ids;
    if (Array.isArray(ids) && ids.length) {
      await supabase.from('inventory').update({ status: 'free', committed_to_order: null }).in('id', ids);
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
