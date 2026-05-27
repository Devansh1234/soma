import { NextResponse } from 'next/server';
import { getCurrentUser, getEffectivePermissions } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { getCompany } from '@/lib/companies';
import { sendSystemEmail, buildItemsTable, emailWrapper } from '@/lib/email';

function parseProductsString(str) {
  if (!str) return [];
  return str.split('; ').map(item => {
    const m = item.match(/^(.+?)\s+\(Rs\.([\d,]+\.?\d*)\s+x\s+(\d+)\)$/);
    if (m) return { name: m[1], price: parseFloat(m[2].replace(/,/g,'')), quantity: parseInt(m[3]) };
    return { name: item, price: 0, quantity: 1 };
  }).filter(p => p.name.trim());
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
    if (!perms.rtc_challan) {
      return NextResponse.json({ error: 'Not authorised to mark RTC' }, { status: 403 });
    }

    const { data: challan } = await supabase
      .from('ChallanRecords')
      .select('*')
      .eq('Challan Number', challanNumber)
      .maybeSingle();

    if (!challan) return NextResponse.json({ error: 'Challan not found' }, { status: 404 });
    if (challan.status === 'rtc')       return NextResponse.json({ error: 'Already marked RTC' }, { status: 400 });
    if (challan.status === 'cancelled') return NextResponse.json({ error: 'Cannot RTC a cancelled challan' }, { status: 400 });

    // Update challan status
    const { error: updErr } = await supabase
      .from('ChallanRecords')
      .update({ status: 'rtc' })
      .eq('Challan Number', challanNumber);
    if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

    // Auto-dispatch linked inventory items (from linked_inventory_ids)
    const ids = challan.linked_inventory_ids;
    if (Array.isArray(ids) && ids.length) {
      await supabase.from('inventory').update({ status: 'dispatched' }).in('id', ids);
    }

    // ── RTC Email ─────────────────────────────────────────────────────────
    const prefix    = challanNumber.split('/')[0];
    const companyMap = { SCC: 'soma', NCC: 'nalanda', GEC: 'gangotri' };
    const company    = getCompany(companyMap[prefix]);

    if (company?.defaultEmail) {
      const products = parseProductsString(challan['Products']);
      const total    = products.reduce((s, p) => s + p.price * p.quantity, 0);

      const tableHtml = buildItemsTable(
        ['Product', 'Qty', 'Unit Price (₹)', 'Total (₹)'],
        products.map(p => [
          'Godrej ' + p.name,
          p.quantity,
          p.price.toLocaleString('en-IN', { minimumFractionDigits: 2 }),
          (p.price * p.quantity).toLocaleString('en-IN', { minimumFractionDigits: 2 }),
        ])
      );

      await sendSystemEmail({
        companyEmail: company.defaultEmail,
        companyName:  company.name,
        subject: `Challan Released — ${challanNumber} — ${challan['Customer Name']}`,
        htmlBody: emailWrapper({
          companyName: company.name,
          title:       `Challan Released to Customer`,
          meta: {
            'Challan No':    challanNumber,
            'Date':          challan['Order Dated'] || '',
            'Customer':      challan['Customer Name'],
            'Order Ref':     challan['Order Reference'] || '—',
            'Invoice No':    challan.invoice_reference || '—',
            'CCID':          challan.ccid || '—',
            'Marked RTC by': user.name,
            'Timestamp':     new Date().toLocaleString('en-IN'),
            'Total Value':   `₹${total.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`,
          },
          tableHtml,
          footer: 'Automated notification from Challan & Warehouse System',
        }),
      });
    }

    return NextResponse.json({ ok: true });
  }

  // ── CANCEL ────────────────────────────────────────────────────────────────
  if (action === 'cancel') {
    if (!perms.cancel_challan) {
      return NextResponse.json({ error: 'Not authorised to cancel challans' }, { status: 403 });
    }

    const { data: challan } = await supabase
      .from('ChallanRecords')
      .select('status, linked_inventory_ids')
      .eq('Challan Number', challanNumber)
      .maybeSingle();

    if (!challan) return NextResponse.json({ error: 'Challan not found' }, { status: 404 });
    if (challan.status === 'cancelled') return NextResponse.json({ error: 'Already cancelled' }, { status: 400 });

    await supabase.from('ChallanRecords').update({ status: 'cancelled' }).eq('Challan Number', challanNumber);

    const ids = challan.linked_inventory_ids;
    if (Array.isArray(ids) && ids.length) {
      await supabase.from('inventory').update({ status: 'free', committed_to_order: null }).in('id', ids);
    }

    return NextResponse.json({ ok: true });
  }

  // ── ADD INVOICE to unbilled challan ───────────────────────────────────────
  if (action === 'add_invoice') {
    if (!invoiceReference?.trim()) {
      return NextResponse.json({ error: 'Invoice reference required' }, { status: 400 });
    }
    await supabase.from('ChallanRecords')
      .update({ invoice_reference: invoiceReference.trim() })
      .eq('Challan Number', challanNumber);
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
}
