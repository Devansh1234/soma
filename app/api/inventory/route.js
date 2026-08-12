import { NextResponse } from 'next/server';
import { getCurrentUser, canAccess } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { getCompany } from '@/lib/companies';
import { sendSystemEmail, buildItemsTable, emailWrapper } from '@/lib/email';

function requireAccess(user) {
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  return null;
}

// Supabase/PostgREST caps every response at 1000 rows regardless of the range
// header, so any request for more must be fetched in chunks and stitched back
// together. Without this, large views silently show only the first 1000 rows.
const PAGE_SIZE = 1000;

export async function GET(request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const status      = searchParams.get('status');
  const location    = searchParams.get('location');
  const q           = searchParams.get('q') || '';
  const limit       = parseInt(searchParams.get('limit') || '500');
  const offset      = parseInt(searchParams.get('offset') || '0');
  const pending     = searchParams.get('pending');      // 'true' | 'false' | null (all)
  const notReceived = searchParams.get('not_received'); // 'true' | 'false' | null (all)

  const companyParam = searchParams.get('company'); // 'all' | 'soma' | 'nalanda' | 'gangotri' | null

  // Optional comma-separated column list. Analysis views only need a handful of
  // columns; sending every column for thousands of rows is slow and can time out.
  const fieldsParam = searchParams.get('fields');
  const ALLOWED_FIELDS = new Set([
    'id','product_code','product_name','quantity','packets_in_product','input_date',
    'type_of_entry','location','price','invoice_number','invoice_date','status',
    'pending_receipt','not_received','invoice_upload_id','company','notes',
    'created_at','updated_at',
  ]);
  const selectCols = fieldsParam
    ? (fieldsParam.split(',').map(f => f.trim()).filter(f => ALLOWED_FIELDS.has(f)).join(',') || '*')
    : '*';

  // Builds a fresh query each call — a Supabase query object cannot be reused
  // once awaited, so each page needs its own.
  const buildQuery = () => {
    let query = supabase
      .from('inventory')
      .select(selectCols, { count: 'exact' })
      .order('created_at', { ascending: false });

    // 'all' = every company (Free Stock, shared warehouse views);
    // specific = that company; default = the user's own company
    if (companyParam === 'all') {
      // no company filter — intentionally show all
    } else if (companyParam) {
      query = query.eq('company', companyParam);
    } else {
      query = query.eq('company', user.company);
    }

    if (status)   query = query.eq('status', status);
    if (location) query = query.eq('location', location);
    if (q)        query = query.ilike('product_name', `%${q}%`);
    if (pending === 'true')      query = query.eq('pending_receipt', true);
    if (pending === 'false')     query = query.eq('pending_receipt', false);
    if (notReceived === 'true')  query = query.eq('not_received', true);
    if (notReceived === 'false') query = query.eq('not_received', false);
    return query;
  };

  const rows = [];
  let totalCount = 0;

  while (rows.length < limit) {
    const want = Math.min(PAGE_SIZE, limit - rows.length);
    const from = offset + rows.length;

    const { data, error, count } = await buildQuery().range(from, from + want - 1);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    if (typeof count === 'number') totalCount = count;
    if (!data?.length) break;

    rows.push(...data);
    if (data.length < want) break; // reached the end of the result set
  }

  // Strip price from non-owner responses (cost price is confidential)
  const isOwner  = user.role === 'owner';
  const safeData = isOwner ? rows : rows.map(({ price, ...rest }) => rest);
  return NextResponse.json({ data: safeData, count: totalCount });
}

export async function POST(request) {
  const user = await getCurrentUser();
  if (!user || !canAccess(user, 'warehouse')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body  = await request.json();
  const items = Array.isArray(body) ? body : [body];
  const company = getCompany(user.company);

  const now = new Date();
  const inputDate = `${String(now.getDate()).padStart(2,'0')}-${String(now.getMonth()+1).padStart(2,'0')}-${now.getFullYear()}`;

  const rows = [];
  for (const item of items) {
    const qty = parseInt(item.quantity) || 1;
    for (let q = 0; q < qty; q++) {
      rows.push({
        product_code:       item.product_code || item.ln_code || null,
        product_name:       item.product_name,
        packets_in_product: item.packets_in_product || null,
        input_date:         item.input_date || inputDate,
        type_of_entry:      item.type_of_entry || 'Manual',
        location:           item.location || null,
        price:              item.price ? parseFloat(item.price) : null,
        invoice_number:     item.invoice_number || null,
        invoice_date:       item.invoice_date || null,
        status:             'free',
        pending_receipt:    false,
        company:            user.company,
      });
    }
  }

  const { data, error } = await supabase.from('inventory').insert(rows).select();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // ── Email on manual add ────────────────────────────────────────────────────
  if (company?.defaultEmail) {
    const tableHtml = buildItemsTable(
      ['Product Name', 'LN Code', 'Qty Added', 'Price (₹)', 'Location'],
      items.map(i => [i.product_name, i.product_code || i.ln_code || '—', parseInt(i.quantity)||1, i.price ? Number(i.price).toLocaleString('en-IN') : '—', i.location || '—'])
    );
    await sendSystemEmail({
      companyEmail: company.defaultEmail,
      companyName:  company.name,
      subject: `Stock Added — ${rows.length} item(s) — Manual Entry`,
      htmlBody: emailWrapper({
        companyName: company.name,
        title: 'Manual Stock Addition',
        meta: { 'Added by': user.name, 'Items Added': rows.length, 'Timestamp': new Date().toLocaleString('en-IN') },
        tableHtml,
        footer: 'Automated notification from Challan & Warehouse System',
      }),
    });
  }

  return NextResponse.json({ ok: true, data });
}

export async function PATCH(request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json();
  const { id, ids, status, location, price, product_name, product_code,
          packets_in_product, input_date, type_of_entry, invoice_number, invoice_date } = body;

  // Bulk status update
  if (ids && status) {
    if (!canAccess(user, 'warehouse') && !canAccess(user, 'order_management')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    // No company restriction — warehouse is shared across companies
    const { error } = await supabase.from('inventory').update({ status }).in('id', ids);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  // Single item update
  if (!canAccess(user, 'warehouse')) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const updates = {};
  if (status         !== undefined) updates.status         = status;
  if (body.not_received !== undefined) updates.not_received = body.not_received;
  if (location       !== undefined) updates.location       = location;
  if (price          !== undefined) updates.price          = price ? parseFloat(price) : null;
  if (product_name   !== undefined) updates.product_name   = product_name;
  if (product_code   !== undefined) updates.product_code   = product_code;
  if (packets_in_product !== undefined) updates.packets_in_product = packets_in_product;
  if (input_date     !== undefined) updates.input_date     = input_date;
  if (type_of_entry  !== undefined) updates.type_of_entry  = type_of_entry;
  if (invoice_number !== undefined) updates.invoice_number = invoice_number;
  if (invoice_date   !== undefined) updates.invoice_date   = invoice_date;

  // No company restriction — warehouse is shared across companies
  const { error } = await supabase.from('inventory').update(updates).eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(request) {
  const user = await getCurrentUser();
  if (!user || !canAccess(user, 'warehouse')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const id     = searchParams.get('id');
  const reason = searchParams.get('reason') || 'Manual removal';
  if (!id) return NextResponse.json({ error: 'ID required' }, { status: 400 });

  const company = getCompany(user.company);

  // Fetch item before deleting (for email)
  const { data: item } = await supabase.from('inventory').select('*').eq('id', id).single();

  // No company restriction — warehouse is shared
  const { error } = await supabase.from('inventory').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // ── Email on manual remove ─────────────────────────────────────────────────
  if (company?.defaultEmail && item) {
    await sendSystemEmail({
      companyEmail: company.defaultEmail,
      companyName:  company.name,
      subject: `Stock Removed — ${item.product_name} — Manual`,
      htmlBody: emailWrapper({
        companyName: company.name,
        title: 'Manual Stock Removal',
        meta: {
          'Product':    item.product_name,
          'LN Code':    item.product_code || '—',
          'Price':      item.price ? `₹${Number(item.price).toLocaleString('en-IN')}` : '—',
          'Reason':     reason,
          'Removed by': user.name,
          'Timestamp':  new Date().toLocaleString('en-IN'),
        },
        tableHtml: '',
        footer: 'Automated notification from Challan & Warehouse System',
      }),
    });
  }

  return NextResponse.json({ ok: true });
}
