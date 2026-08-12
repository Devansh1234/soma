import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { supabase } from '@/lib/supabase';

// GET: outstanding shortfalls, grouped by product
export async function GET(request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const company = searchParams.get('company') || 'all';

  const { data, error } = await supabase.rpc('open_shortfalls', { p_company: company });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = (data || []).map(r => ({
    product_code: r.product_code,
    product_name: r.product_name,
    company:      r.company,
    units_owed:   Number(r.units_owed) || 0,
    row_count:    Number(r.row_count)  || 0,
    challans:     r.challans || '',
    first_seen:   r.first_seen || '',
    ids:          r.ids || [],
  }));

  return NextResponse.json({
    rows,
    totalUnits: rows.reduce((s, r) => s + r.units_owed, 0),
  });
}

// POST: resolve shortfall rows (write them off as legacy stock never entered
// into the system). Rows are kept with a resolution stamp, not deleted.
export async function POST(request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { ids, resolution } = await request.json();
  if (!Array.isArray(ids) || !ids.length) {
    return NextResponse.json({ error: 'ids required' }, { status: 400 });
  }

  const { error } = await supabase
    .from('inventory')
    .update({
      resolved_at: new Date().toISOString(),
      resolved_by: user.name,
      resolution:  resolution || 'not_in_system',
    })
    .in('id', ids)
    .eq('status', 'shortfall');

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, resolved: ids.length });
}
