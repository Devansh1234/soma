import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { supabase } from '@/lib/supabase';

const WAREHOUSE_KEYS = {
  'Bhelupur Warehouse':  { key:'int_bhe', prefix:'INT/BHE' },
  'Lehertara Warehouse': { key:'int_leh', prefix:'INT/LEH' },
  'Rohaniya Warehouse':  { key:'int_roh', prefix:'INT/ROH' },
};

export async function GET(request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error:'Unauthorized' },{status:401});

  const { searchParams } = new URL(request.url);
  const warehouse = searchParams.get('warehouse') || 'Bhelupur Warehouse';
  const wh        = WAREHOUSE_KEYS[warehouse] || WAREHOUSE_KEYS['Bhelupur Warehouse'];

  const now   = new Date();
  const year  = now.getFullYear();
  const month = now.getMonth() + 1;
  const mm    = String(month).padStart(2,'0');

  // Peek at current counter without incrementing
  const { data } = await supabase
    .from('challan_counters')
    .select('last_seq')
    .eq('company', wh.key)
    .eq('year', year)
    .eq('month', month)
    .maybeSingle();

  const next = ((data?.last_seq || 0) + 1).toString().padStart(3,'0');
  return NextResponse.json({ preview: `~${wh.prefix}/${year}/${mm}/${next}` });
}
