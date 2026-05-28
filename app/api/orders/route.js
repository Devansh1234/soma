import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { getCompany } from '@/lib/companies';
import { sendSystemEmail, buildItemsTable, emailWrapper } from '@/lib/email';

// ── GET: list orders ──────────────────────────────────────────────────────────
export async function GET(request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const status = searchParams.get('status') || '';

  let query = supabase
    .from('orders')
    .select('*, order_items(*)')
    .eq('company', user.company)
    .order('created_at', { ascending: false });

  // Retailers only see their own orders
  if (user.role === 'retailer') {
    query = query.eq('retailer_name', user.name);
  }
  if (status) query = query.eq('status', status);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data });
}

// ── POST: create new order (retailer submits booking) ─────────────────────────
export async function POST(request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { items, notes } = await request.json();
  if (!items?.length) return NextResponse.json({ error: 'At least one item required' }, { status: 400 });

  const company = getCompany(user.company);

  // Create order record
  // Generate unique order number: ORD/YYYY/MM/timestamp-suffix
  const now2 = new Date();
  const orderNumber = `ORD/${now2.getFullYear()}/${String(now2.getMonth()+1).padStart(2,'0')}/${Date.now().toString().slice(-6)}`;

  const { data: order, error: orderErr } = await supabase
    .from('orders')
    .insert({
      order_number:  orderNumber,
      retailer_name: user.name,
      retailer_id:   user.id,
      company:       user.company,
      status:        'pending_booking',
      notes:         notes || null,
    })
    .select()
    .single();
  if (orderErr) return NextResponse.json({ error: orderErr.message }, { status: 500 });

  // Create order items
  const itemRows = items.map(item => ({
    order_id:      order.id,
    product_name:  item.product_name,
    ln_code:       item.ln_code || null,
    ordered_qty:   parseInt(item.quantity) || 1,
    delivered_qty: 0,
    status:        'pending_booking',
    retailer_name: user.name,
    company:       user.company,
  }));

  const { error: itemsErr } = await supabase.from('order_items').insert(itemRows);
  if (itemsErr) {
    await supabase.from('orders').delete().eq('id', order.id);
    return NextResponse.json({ error: itemsErr.message }, { status: 500 });
  }

  // ── Email company on new booking ──────────────────────────────────────────
  if (company?.defaultEmail) {
    const tableHtml = buildItemsTable(
      ['Product Name', 'LN Code', 'Qty'],
      items.map(i => [i.product_name, i.ln_code || '—', i.quantity])
    );
    await sendSystemEmail({
      companyEmail: company.defaultEmail,
      companyName:  company.name,
      subject: `New Order Booking — ${user.name} — ${items.length} item(s)`,
      htmlBody: emailWrapper({
        companyName: company.name,
        title:       `New Order from ${user.name}`,
        meta: {
          'Retailer':    user.name,
          'Items':       items.length,
          'Total Units': items.reduce((s,i) => s + (parseInt(i.quantity)||1), 0),
          'Submitted':   new Date().toLocaleString('en-IN'),
          'Notes':       notes || '—',
        },
        tableHtml,
        footer: 'Automated notification from Challan & Warehouse System',
      }),
    });
  }

  return NextResponse.json({ ok: true, orderId: order.id });
}
