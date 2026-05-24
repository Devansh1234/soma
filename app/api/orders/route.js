import { NextResponse } from 'next/server';
import { getCurrentUser, canAccess } from '@/lib/auth';
import { supabase } from '@/lib/supabase';

export async function GET(request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const status = searchParams.get('status');

  let query = supabase
    .from('orders')
    .select(`*, order_items(*)`)
    .eq('company', user.company)
    .order('created_at', { ascending: false });

  // Retailers only see their own orders
  if (user.role === 'retailer') {
    query = query.eq('retailer_id', user.id);
  }

  if (status) query = query.eq('status', status);

  const { data, error } = await query.limit(200);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function POST(request) {
  const user = await getCurrentUser();
  if (!user || !canAccess(user, 'order_booking')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const { items, notes } = body;
  if (!items?.length) return NextResponse.json({ error: 'No items in order' }, { status: 400 });

  // Generate order number
  const orderNum = `ORD-${user.company.toUpperCase().slice(0, 3)}-${Date.now()}`;

  const { data: order, error: orderError } = await supabase
    .from('orders')
    .insert({
      order_number: orderNum,
      retailer_id: user.id,
      retailer_name: user.name,
      company: user.company,
      status: 'booked',
      notes: notes || '',
    })
    .select()
    .single();

  if (orderError) return NextResponse.json({ error: orderError.message }, { status: 500 });

  const orderItems = items.map(item => ({
    order_id: order.id,
    product_name: item.product_name,
    quantity: parseInt(item.quantity) || 1,
    price: item.price ? parseFloat(item.price) : null,
  }));

  const { error: itemsError } = await supabase.from('order_items').insert(orderItems);
  if (itemsError) return NextResponse.json({ error: itemsError.message }, { status: 500 });

  return NextResponse.json({ ok: true, order });
}

export async function PATCH(request) {
  const user = await getCurrentUser();
  if (!user || !canAccess(user, 'order_management')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const { id, status, notes } = body;
  if (!id) return NextResponse.json({ error: 'Order ID required' }, { status: 400 });

  const updates = {};
  if (status) updates.status = status;
  if (notes !== undefined) updates.notes = notes;

  // When confirming, commit inventory items if linked
  if (status === 'confirmed') {
    const { data: order } = await supabase
      .from('orders')
      .select('*, order_items(*)')
      .eq('id', id)
      .single();

    if (order?.order_items) {
      const linkedInventoryIds = order.order_items
        .filter(i => i.inventory_item_id)
        .map(i => i.inventory_item_id);

      if (linkedInventoryIds.length) {
        await supabase
          .from('inventory')
          .update({ status: 'committed', committed_to_order: id })
          .in('id', linkedInventoryIds);
      }
    }
  }

  // When dispatching, mark inventory as dispatched
  if (status === 'dispatched') {
    await supabase
      .from('inventory')
      .update({ status: 'dispatched' })
      .eq('committed_to_order', id);
  }

  // When cancelling, free committed inventory
  if (status === 'cancelled') {
    await supabase
      .from('inventory')
      .update({ status: 'free', committed_to_order: null })
      .eq('committed_to_order', id);
  }

  const { error } = await supabase
    .from('orders')
    .update(updates)
    .eq('id', id)
    .eq('company', user.company);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
