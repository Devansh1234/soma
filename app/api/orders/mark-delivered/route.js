import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { supabase } from '@/lib/supabase';

export async function POST(request) {
  const user = await getCurrentUser();
  if (!user || !['owner','office_employee'].includes(user.role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { itemId, deliveredQty, challanNo, billNo, deliveredDate } = await request.json();
  if (!itemId || !challanNo?.trim()) {
    return NextResponse.json({ error: 'itemId and challanNo required' }, { status: 400 });
  }

  // Fetch current item
  const { data: item, error: fetchErr } = await supabase
    .from('order_items')
    .select('*')
    .eq('id', itemId)
    .single();
  if (fetchErr || !item) return NextResponse.json({ error: 'Item not found' }, { status: 404 });

  const qty          = Math.min(Math.max(1, parseInt(deliveredQty) || 1), item.ordered_qty - item.delivered_qty);
  const newDelivered = item.delivered_qty + qty;
  const fullyDone    = newDelivered >= item.ordered_qty;

  // Goods often go out before anyone records it, so the date is entered by the
  // user. A plain YYYY-MM-DD is read as UTC midnight, which can show as the
  // previous day in IST — so pin it to midday to keep the calendar date intact.
  const deliveredAt = deliveredDate
    ? new Date(`${deliveredDate}T12:00:00`).toISOString()
    : new Date().toISOString();

  const updates = {
    delivered_qty:  newDelivered,
    status:         fullyDone ? 'delivered' : 'pending_delivery',
    challan_refs:   [...(item.challan_refs || []), challanNo.trim()],
    bill_numbers:   billNo?.trim() ? [...(item.bill_numbers || []), billNo.trim()] : (item.bill_numbers || []),
    delivered_at:   fullyDone ? deliveredAt : null,
  };

  const { error: updErr } = await supabase
    .from('order_items')
    .update(updates)
    .eq('id', itemId);
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

  // If all items in the order are now delivered, update order status
  if (fullyDone) {
    const { data: siblings } = await supabase
      .from('order_items')
      .select('status')
      .eq('order_id', item.order_id)
      .neq('id', itemId);

    const allDone = (siblings || []).every(s => s.status === 'delivered');
    if (allDone) {
      await supabase.from('orders')
        .update({ status: 'delivered', updated_at: deliveredAt })
        .eq('id', item.order_id);
    }
  }

  return NextResponse.json({ ok: true, fullyDone, newDelivered, remaining: item.ordered_qty - newDelivered });
}
