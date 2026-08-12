import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { supabase } from '@/lib/supabase';

// Indian financial year: 1 April (fyYear) → 31 March (fyYear + 1)
function getFYRange(fyYear) {
  return { start: new Date(fyYear, 3, 1), end: new Date(fyYear + 1, 3, 1) };
}

// Q1 = Apr-Jun, Q2 = Jul-Sep, Q3 = Oct-Dec, Q4 = Jan-Mar (of the following year)
function getQuarterRange(fyYear, quarter) {
  const starts = [
    new Date(fyYear,     3, 1),  // Q1: Apr
    new Date(fyYear,     6, 1),  // Q2: Jul
    new Date(fyYear,     9, 1),  // Q3: Oct
    new Date(fyYear + 1, 0, 1),  // Q4: Jan
  ];
  const ends = [
    new Date(fyYear,     6, 1),
    new Date(fyYear,     9, 1),
    new Date(fyYear + 1, 0, 1),
    new Date(fyYear + 1, 3, 1),
  ];
  const i = Math.min(Math.max(quarter, 1), 4) - 1;
  return { start: starts[i], end: ends[i] };
}

// A calendar month within the financial year: months 1-3 (Jan-Mar) fall in fyYear + 1
function getMonthRange(fyYear, month) {
  const year = month <= 3 ? fyYear + 1 : fyYear;
  return { start: new Date(year, month - 1, 1), end: new Date(year, month, 1) };
}

export async function GET(request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const company    = searchParams.get('company') || user.company;
  const periodType = searchParams.get('period')  || 'year';   // month | quarter | year
  const fyYear     = parseInt(searchParams.get('fy_year') || new Date().getFullYear());
  const month      = parseInt(searchParams.get('month')   || String(new Date().getMonth() + 1));
  const quarter    = parseInt(searchParams.get('quarter') || '1');

  let range;
  if      (periodType === 'month')   range = getMonthRange(fyYear, month);
  else if (periodType === 'quarter') range = getQuarterRange(fyYear, quarter);
  else                               range = getFYRange(fyYear);

  const args = {
    p_company: company,
    p_start:   range.start.toISOString(),
    p_end:     range.end.toISOString(),
  };

  // Aggregated in Postgres: no row-count cap, no giant .in(...) URL, one round trip each.
  const [{ data: rows, error: rowsErr }, { data: trend, error: trendErr }] = await Promise.all([
    supabase.rpc('billing_by_salesman',   args),
    supabase.rpc('billing_monthly_trend', args),
  ]);

  if (rowsErr)  return NextResponse.json({ error: rowsErr.message },  { status: 500 });
  if (trendErr) return NextResponse.json({ error: trendErr.message }, { status: 500 });

  const cleanRows = (rows || []).map(r => ({
    salesman_code: r.salesman_code,
    invoice_count: Number(r.invoice_count) || 0,
    total_billing: Number(r.total_billing) || 0,
  }));

  const monthlyTrend = {};
  for (const t of (trend || [])) monthlyTrend[t.ym] = Number(t.total) || 0;

  return NextResponse.json({
    rows:         cleanRows,
    grandTotal:   cleanRows.reduce((s, r) => s + r.total_billing, 0),
    invoiceCount: cleanRows.reduce((s, r) => s + r.invoice_count, 0),
    monthlyTrend,
    period: { start: range.start.toISOString(), end: range.end.toISOString() },
  });
}
