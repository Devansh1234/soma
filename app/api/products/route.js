import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { supabase } from '@/lib/supabase';

export async function GET(request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const q       = searchParams.get('q') || '';
  const byLN    = searchParams.get('ln') || ''; // lookup by exact LN code
  const limit   = parseInt(searchParams.get('limit') || '20');

  // Lookup single product by LN code (used when employee types LN code first)
  if (byLN) {
    const { data } = await supabase
      .from('products')
      .select('ln_code, name, hsn_code, base_price, category')
      .eq('ln_code', byLN.trim().toUpperCase())
      .maybeSingle();
    return NextResponse.json(data || null);
  }

  if (!q.trim()) return NextResponse.json([]);

  // Search by name (ilike) — return objects with name + ln_code + price
  const { data, error } = await supabase
    .from('products')
    .select('ln_code, name, hsn_code, base_price, category')
    .ilike('name', `%${q}%`)
    .order('name', { ascending: true })
    .limit(limit);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Also check old Products table for any names not yet in new table
  // (backward compat — returns plain strings merged in)
  return NextResponse.json(data || []);
}
