import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { supabase } from '@/lib/supabase';

export const CATEGORIES = [
  'home_storage', 'home_furniture', 'kitchen', 'b2b',
  'security', 'mattress', 'krex3', 'other',
];

// GET  ?mode=list      → recent day entries (with their splits)
// GET  ?mode=salesmen  → salesman dropdown options
// GET  ?mode=day&date=&showroom=  → one day's entry for editing
export async function GET(request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const mode     = searchParams.get('mode') || 'list';
  const showroom = searchParams.get('showroom') || 'all';

  if (mode === 'salesmen') {
    let q = supabase.from('walkin_salesmen').select('*').eq('is_active', true).order('name');
    if (showroom !== 'all') q = q.eq('showroom', showroom);
    const { data, error } = await q;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ salesmen: data || [] });
  }

  if (mode === 'day') {
    const date = searchParams.get('date');
    if (!date) return NextResponse.json({ error: 'date required' }, { status: 400 });
    const { data: day } = await supabase
      .from('walkin_days').select('*')
      .eq('entry_date', date).eq('showroom', showroom).maybeSingle();
    if (!day) return NextResponse.json({ day: null });

    const [{ data: cats }, { data: sms }] = await Promise.all([
      supabase.from('walkin_category_sales').select('category, amount').eq('day_id', day.id),
      supabase.from('walkin_salesman_sales').select('salesman_name, amount').eq('day_id', day.id),
    ]);
    return NextResponse.json({ day, categories: cats || [], salesmen: sms || [] });
  }

  // Default: recent entries
  const limit = parseInt(searchParams.get('limit') || '60');
  let q = supabase.from('walkin_days').select('*').order('entry_date', { ascending: false }).limit(limit);
  if (showroom !== 'all') q = q.eq('showroom', showroom);
  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ days: data || [] });
}

// POST: create or replace a day's entry (idempotent per date + showroom)
export async function POST(request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json();
  const {
    entry_date, showroom, company,
    walkins, conversions, total_amount, includes_gst,
    categories = {},   // { home_storage: 84000, ... }
    salesmen  = {},    // { Ajay: 112600, ... }
    notes,
  } = body;

  if (!entry_date || !showroom || !company) {
    return NextResponse.json({ error: 'entry_date, showroom and company are required' }, { status: 400 });
  }
  if (Number(conversions) > Number(walkins)) {
    return NextResponse.json({ error: 'Conversions cannot exceed walk-ins' }, { status: 400 });
  }

  // Upsert the day row so re-saving the same date overwrites cleanly
  const { data: day, error: dayErr } = await supabase
    .from('walkin_days')
    .upsert({
      entry_date,
      showroom,
      company,
      walkins:      Number(walkins)      || 0,
      conversions:  Number(conversions)  || 0,
      total_amount: Number(total_amount) || 0,
      includes_gst: includes_gst !== false,
      notes:        notes || null,
      entered_by:   user.name,
    }, { onConflict: 'entry_date,showroom' })
    .select()
    .single();

  if (dayErr) return NextResponse.json({ error: dayErr.message }, { status: 500 });

  // Replace the splits wholesale — simpler and safer than diffing
  await supabase.from('walkin_category_sales').delete().eq('day_id', day.id);
  await supabase.from('walkin_salesman_sales').delete().eq('day_id', day.id);

  const catRows = Object.entries(categories)
    .filter(([k, v]) => CATEGORIES.includes(k) && Number(v) > 0)
    .map(([category, amount]) => ({ day_id: day.id, category, amount: Number(amount) }));

  const smRows = Object.entries(salesmen)
    .filter(([name, v]) => name.trim() && Number(v) > 0)
    .map(([salesman_name, amount]) => ({
      day_id: day.id, salesman_name: salesman_name.trim(), amount: Number(amount),
    }));

  if (catRows.length) {
    const { error } = await supabase.from('walkin_category_sales').insert(catRows);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (smRows.length) {
    const { error } = await supabase.from('walkin_salesman_sales').insert(smRows);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Remember any salesman name not already on the dropdown
  for (const r of smRows) {
    await supabase.from('walkin_salesmen')
      .upsert({ name: r.salesman_name, showroom, company }, { onConflict: 'name,showroom' });
  }

  return NextResponse.json({ ok: true, day_id: day.id });
}

// DELETE ?date=&showroom=  → remove a day entry (splits cascade)
export async function DELETE(request) {
  const user = await getCurrentUser();
  if (!user || user.role !== 'owner') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { searchParams } = new URL(request.url);
  const date     = searchParams.get('date');
  const showroom = searchParams.get('showroom');
  if (!date || !showroom) return NextResponse.json({ error: 'date and showroom required' }, { status: 400 });

  const { error } = await supabase
    .from('walkin_days').delete().eq('entry_date', date).eq('showroom', showroom);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
