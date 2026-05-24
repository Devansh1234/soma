import { NextResponse } from 'next/server';
import { getCurrentUser, canAccess } from '@/lib/auth';
import { supabase } from '@/lib/supabase';

function requireAccess(user, tab) {
  if (!user || !canAccess(user, tab)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  return null;
}

export async function GET(request) {
  const user = await getCurrentUser();
  const denied = requireAccess(user, 'free_stock') && requireAccess(user, 'warehouse');
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const status = searchParams.get('status');
  const location = searchParams.get('location');
  const q = searchParams.get('q') || '';
  const limit = parseInt(searchParams.get('limit') || '200');
  const offset = parseInt(searchParams.get('offset') || '0');

  let query = supabase
    .from('inventory')
    .select('*', { count: 'exact' })
    .eq('company', user.company)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (status) query = query.eq('status', status);
  if (location) query = query.eq('location', location);
  if (q) query = query.ilike('product_name', `%${q}%`);

  const { data, error, count } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data, count });
}

export async function POST(request) {
  const user = await getCurrentUser();
  if (!user || !canAccess(user, 'warehouse')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const items = Array.isArray(body) ? body : [body];

  const rows = items.map(item => ({
    product_code: item.product_code || null,
    product_name: item.product_name,
    packets_in_product: item.packets_in_product || null,
    input_date: item.input_date || null,
    type_of_entry: item.type_of_entry || 'Manual',
    location: item.location || null,
    price: item.price ? parseFloat(item.price) : null,
    invoice_number: item.invoice_number || null,
    invoice_date: item.invoice_date || null,
    status: 'free',
    company: user.company,
  }));

  const { data, error } = await supabase.from('inventory').insert(rows).select();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, data });
}

export async function PATCH(request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json();
  const { id, ids, status, location, price, product_name, product_code, packets_in_product, input_date, type_of_entry, invoice_number, invoice_date } = body;

  // Bulk status update
  if (ids && status) {
    if (!canAccess(user, 'warehouse') && !canAccess(user, 'order_management')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const { error } = await supabase
      .from('inventory')
      .update({ status })
      .in('id', ids)
      .eq('company', user.company);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  // Single item update
  if (!canAccess(user, 'warehouse')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const updates = {};
  if (status !== undefined) updates.status = status;
  if (location !== undefined) updates.location = location;
  if (price !== undefined) updates.price = price ? parseFloat(price) : null;
  if (product_name !== undefined) updates.product_name = product_name;
  if (product_code !== undefined) updates.product_code = product_code;
  if (packets_in_product !== undefined) updates.packets_in_product = packets_in_product;
  if (input_date !== undefined) updates.input_date = input_date;
  if (type_of_entry !== undefined) updates.type_of_entry = type_of_entry;
  if (invoice_number !== undefined) updates.invoice_number = invoice_number;
  if (invoice_date !== undefined) updates.invoice_date = invoice_date;

  const { error } = await supabase
    .from('inventory')
    .update(updates)
    .eq('id', id)
    .eq('company', user.company);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(request) {
  const user = await getCurrentUser();
  if (!user || !canAccess(user, 'warehouse')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'ID required' }, { status: 400 });

  const { error } = await supabase
    .from('inventory')
    .delete()
    .eq('id', id)
    .eq('company', user.company);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
