import { NextResponse } from 'next/server';
import { getCurrentUser, getEffectivePermissions } from '@/lib/auth';
import { supabase } from '@/lib/supabase';

export async function PATCH(request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { action, orderId, itemUpdates } = await request.json();
  // itemUpdates: [{ id, so_number }]

  if (!orderId) return NextResponse.json({ error: 'orderId required' }, { status: 400 });

  // Verify order belongs to this company
  const { data: order } = await supabase
    .from('orders')
    .select('*, order_items(*)')
    .eq('id', orderId)
    .eq('company', user.company)
    .single();

  if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 });

  // ── BOOK: assign SO numbers, move items to pending_delivery ──────────────
  if (action === 'book') {
    if (!['owner','office_employee'].includes(user.role)) {
      return NextResponse.json({ error: 'Not authorised to book orders' }, { status: 403 });
    }
    if (!itemUpdates?.length) return NextResponse.json({ error: 'itemUpdates required' }, { status: 400 });

    // Update each item with its SO number
    for (const upd of itemUpdates) {
      if (!upd.so_number?.trim()) continue;
      await supabase.from('order_items').update({
        so_number:  upd.so_number.trim(),
        status:     'pending_delivery',
        booked_at:  new Date().toISOString(),
      }).eq('id', upd.id).eq('order_id', orderId);
    }

    // Derive order status from items
    const { data: updatedItems } = await supabase
      .from('order_items')
      .select('status')
      .eq('order_id', orderId);

    const allPendingDelivery = updatedItems?.every(i => i.status !== 'pending_booking');
    if (allPendingDelivery) {
      await supabase.from('orders').update({ status: 'pending_delivery', updated_at: new Date().toISOString() }).eq('id', orderId);
    }

    return NextResponse.json({ ok: true });
  }

  // ── CANCEL: owner only ────────────────────────────────────────────────────
  if (action === 'cancel') {
    const perms = getEffectivePermissions(user);
    if (user.role !== 'owner') {
      return NextResponse.json({ error: 'Only owners can cancel orders' }, { status: 403 });
    }
    await supabase.from('order_items').update({ status: 'cancelled' }).eq('order_id', orderId);
    await supabase.from('orders').update({ status: 'cancelled', updated_at: new Date().toISOString() }).eq('id', orderId);
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
}
