import { NextResponse } from 'next/server';
import { getCurrentUser, canAccess } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { getCompany, formatChallanNumber } from '@/lib/companies';
import { computeCCID } from '@/lib/permissions';

function fmtDate(isoStr) {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  if (isNaN(d)) return isoStr;
  return d.toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' }).replace(/ /g,'-');
}

function fmtDateShort(isoStr) {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  if (isNaN(d)) return isoStr;
  return d.toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'2-digit' }).replace(/ /g,'-');
}



// ── GET: list challan records ──────────────────────────────────────────────────
export async function GET(request) {
  const user = await getCurrentUser();
  if (!user || !canAccess(user, 'challan')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const limit    = parseInt(searchParams.get('limit')  || '200');
  const offset   = parseInt(searchParams.get('offset') || '0');
  const search   = searchParams.get('search')   || '';
  const status   = searchParams.get('status')   || '';
  const monthNum = searchParams.get('month')    || '';
  const yearNum  = searchParams.get('year')     || '';
  const unbilled         = searchParams.get('unbilled') === '1';
  const excludeInternal  = searchParams.get('exclude_internal') === '1';

  const companyParam = searchParams.get('company'); // 'all' skips prefix filter (warehouse view)
  const company = getCompany(user.company);
  const prefix  = company?.prefix || '';

  let query = supabase
    .from('ChallanRecords')
    .select('*', { count: 'exact' })
    .order('Challan Number', { ascending: false })
    .range(offset, offset + limit - 1);

  // Skip prefix filter when company=all (shared warehouse sees all companies)
  if (companyParam !== 'all') {
    query = query.like('Challan Number', `${prefix}/%`);
  }

  if (search)   query = query.or(`"Customer Name".ilike.%${search}%,"Challan Number".ilike.%${search}%,ccid.ilike.%${search}%`);
  if (status)   query = query.eq('status', status);
  if (monthNum) query = query.eq('month_num', parseInt(monthNum));
  if (yearNum)  query = query.eq('year_num',  parseInt(yearNum));
  if (unbilled)        query = query.or('invoice_reference.is.null,invoice_reference.eq.');
  if (excludeInternal) query = query.or('challan_type.is.null,challan_type.eq.customer');

  const { data, error, count } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data, count });
}

// ── POST: generate new challan ─────────────────────────────────────────────────
export async function POST(request) {
  const user = await getCurrentUser();
  if (!user || !canAccess(user, 'challan')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { customer, products, orderReference, orderDate,
            invoiceReference, invoiceDated, companyOverride } = body;

    const companyId = user.role === 'owner' && companyOverride ? companyOverride : user.company;
    const company   = getCompany(companyId);
    if (!company)          return NextResponse.json({ error: 'Invalid company' },               { status: 400 });
    if (!customer?.name)   return NextResponse.json({ error: 'Customer name required' },        { status: 400 });
    if (!products?.length) return NextResponse.json({ error: 'At least one product required' }, { status: 400 });

    const now   = new Date();
    const year  = now.getFullYear();
    const month = now.getMonth() + 1;

    // Atomic counter increment
    const { data: seq, error: cErr } = await supabase
      .rpc('get_next_challan_number', { p_company: companyId, p_year: year, p_month: month });
    if (cErr) throw cErr;

    const challanNumber = formatChallanNumber(company.prefix, year, month, seq);
    const ccid          = computeCCID(user.name, challanNumber);

    // Date formatting
    const challanDate  = fmtDate(now.toISOString());
    const orderedShort = fmtDateShort(orderDate || now.toISOString());
    const orderedFull  = fmtDate(orderDate || now.toISOString());
    const invoiceFull  = invoiceDated ? fmtDate(invoiceDated) : '';
    const pad          = n => String(n).padStart(2, '0');
    const generatedDT  = `${pad(now.getDate())}-${pad(now.getMonth()+1)}-${now.getFullYear()} ${pad(now.getHours())}:${pad(now.getMinutes())}`;

    // Include LN code in brackets when available — enables RTC inventory dispatch
    const productsStr = products
      .map(p => `${p.name}${p.ln_code ? ' ['+p.ln_code.trim()+']' : ''} (Rs.${parseFloat(p.price).toFixed(2)} x ${p.quantity})`)
      .join('; ');

    // Save challan record
    const { error: insErr } = await supabase.from('ChallanRecords').insert({
      'Challan Number':     challanNumber,
      'Customer Name':      customer.name,
      'GSTIN':              customer.gstin    || '',
      'Address Line 1':     customer.address1 || '',
      'Address Line 2':     customer.address2 || '',
      'Mobile':             customer.mobile   || '',
      'Order Reference':    orderReference    || '',
      'Order Dated':        orderedShort,
      'Generated DateTime': generatedDT,
      'Products':           productsStr,
      status:               'awaiting_delivery',
      created_by_name:      user.name,
      ccid,
      invoice_reference:    invoiceReference || null,
      invoice_dated:        invoiceFull      || null,
      month_num:            month,
      year_num:             year,
      linked_inventory_ids: [],
    });
    if (insErr) throw insErr;

    // Save/update customer
    if (customer.name && customer.save) {
      await supabase.from('Customers').upsert({
        Name: customer.name, GSTIN: customer.gstin || '',
        Address_L1: customer.address1 || '', Address_L2: customer.address2 || '',
        Number: customer.mobile || '',
      }, { onConflict: 'Name', ignoreDuplicates: false });
    }

    return NextResponse.json({
      challanNumber, challanDate, ccid, company, customer, products,
      orderReference:   orderReference || '',
      orderDate:        orderedFull,
      invoiceReference: invoiceReference || '',
      invoiceDated:     invoiceFull,
      generatedAt:      generatedDT,
    });

  } catch (err) {
    console.error('Challan error:', err);
    return NextResponse.json({ error: err.message || 'Server error' }, { status: 500 });
  }
}
