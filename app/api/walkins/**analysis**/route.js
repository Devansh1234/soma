import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { supabase } from '@/lib/supabase';

export async function GET(request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const showroom = searchParams.get('showroom') || 'all';
  const start    = searchParams.get('start');
  const end      = searchParams.get('end');

  if (!start || !end) {
    return NextResponse.json({ error: 'start and end dates required' }, { status: 400 });
  }

  const args = { p_showroom: showroom, p_start: start, p_end: end };

  const [summaryRes, catRes, smRes, seriesRes] = await Promise.all([
    supabase.rpc('walkin_summary',      args),
    supabase.rpc('walkin_by_category',  args),
    supabase.rpc('walkin_by_salesman',  args),
    supabase.rpc('walkin_daily_series', args),
  ]);

  for (const r of [summaryRes, catRes, smRes, seriesRes]) {
    if (r.error) return NextResponse.json({ error: r.error.message }, { status: 500 });
  }

  const s = Array.isArray(summaryRes.data) ? summaryRes.data[0] : summaryRes.data;

  return NextResponse.json({
    summary: {
      days_reported:     Number(s?.days_reported)     || 0,
      total_walkins:     Number(s?.total_walkins)     || 0,
      total_conversions: Number(s?.total_conversions) || 0,
      total_sales:       Number(s?.total_sales)       || 0,
      conversion_rate:   Number(s?.conversion_rate)   || 0,
      avg_ticket:        Number(s?.avg_ticket)        || 0,
    },
    categories: (catRes.data || []).map(r => ({
      category: r.category, amount: Number(r.amount) || 0, days: Number(r.days_with_sales) || 0,
    })),
    salesmen: (smRes.data || []).map(r => ({
      name: r.salesman_name, amount: Number(r.amount) || 0, days: Number(r.days_active) || 0,
    })),
    series: (seriesRes.data || []).map(r => ({
      date: r.entry_date,
      walkins: Number(r.walkins) || 0,
      conversions: Number(r.conversions) || 0,
      amount: Number(r.total_amount) || 0,
    })),
  });
}
