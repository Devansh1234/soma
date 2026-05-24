import { NextResponse } from 'next/server';
import { getCurrentUser, getEffectivePermissions } from '@/lib/auth';
import { supabase } from '@/lib/supabase';

export async function POST(request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { challanNumber, action, invoiceReference } = await request.json();
  if (!challanNumber || !action) {
    return NextResponse.json({ error: 'challanNumber and action required' }, { status: 400 });
  }

  const perms = getEffectivePermissions(user);

  // ── RTC ────────────────────────────────────────────────────────────────────
  if (action === 'rtc') {
    if (!perms.rtc_challan) {
      return NextResponse.json({ error: 'Not authorised to mark RTC' }, { status: 403 });
    }

    // Fetch challan to get linked inventory ids
    const { data: challan } = await supabase
      .from('ChallanRecords')
      .select('linked_inventory_ids, status')
      .eq('Challan Number', challanNumber)
      .maybeSingle();

    if (!challan) return NextResponse.json({ error: 'Challan not found' }, { status: 404 });
    if (challan.status === 'rtc') return NextResponse.json({ error: 'Already marked RTC' }, { status: 400 });
    if (challan.status === 'cancelled') return NextResponse.json({ error: 'Cannot RTC a cancelled challan' }, { status: 400 });

    // Update challan status
    const { error: updErr } = await supabase
      .from('ChallanRecords')
      .update({ status: 'rtc' })
      .eq('Challan Number', challanNumber);
    if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

    // Auto-dispatch linked inventory items
    const ids = challan.linked_inventory_ids;
    if (Array.isArray(ids) && ids.length) {
      await supabase
        .from('inventory')
        .update({ status: 'dispatched' })
        .in('id', ids);
    }

    return NextResponse.json({ ok: true });
  }

  // ── CANCEL ─────────────────────────────────────────────────────────────────
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

    await supabase
      .from('ChallanRecords')
      .update({ status: 'cancelled' })
      .eq('Challan Number', challanNumber);

    // Free up any committed inventory
    const ids = challan.linked_inventory_ids;
    if (Array.isArray(ids) && ids.length) {
      await supabase
        .from('inventory')
        .update({ status: 'free', committed_to_order: null })
        .in('id', ids);
    }

    return NextResponse.json({ ok: true });
  }

  // ── ADD INVOICE (update unbilled challan) ──────────────────────────────────
  if (action === 'add_invoice') {
    if (!invoiceReference?.trim()) {
      return NextResponse.json({ error: 'Invoice reference required' }, { status: 400 });
    }
    await supabase
      .from('ChallanRecords')
      .update({ invoice_reference: invoiceReference.trim() })
      .eq('Challan Number', challanNumber);
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
}
