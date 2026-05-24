import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { getCompany } from '@/lib/companies';

export async function GET(request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const companyId = searchParams.get('company') || user.company;
  const company   = getCompany(companyId);
  if (!company) return NextResponse.json({ error: 'Invalid company' }, { status: 400 });

  const now   = new Date();
  const year  = now.getFullYear();
  const month = now.getMonth() + 1;

  // READ current counter without incrementing
  const { data } = await supabase
    .from('challan_counters')
    .select('current_number')
    .eq('company', companyId)
    .eq('year', year)
    .eq('month', month)
    .maybeSingle();

  const nextNum = (data?.current_number || 0) + 1;
  const mm      = String(month).padStart(2, '0');
  const sss     = String(nextNum).padStart(3, '0');
  // ~ prefix = estimate, not reserved
  const preview = `~${company.prefix}/${year}/${mm}/${sss}`;

  return NextResponse.json({ preview });
}
