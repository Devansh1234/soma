import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { getCompany } from '@/lib/companies';
import { computeCCID } from '@/lib/permissions';
import { sendSystemEmail, buildItemsTable, emailWrapper } from '@/lib/email';

const WAREHOUSE_PREFIXES = {
  'Bhelupur Warehouse': { key: 'int_bhe', prefix: 'INT/BHE' },
  'Lehertara Warehouse':{ key: 'int_leh', prefix: 'INT/LEH' },
  'Rohaniya Warehouse': { key: 'int_roh', prefix: 'INT/ROH' },
};

function fmtDate(d = new Date()) {
  return d.toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'}).replace(/ /g,'-');
}

// GET: list internal challans for this company
export async function GET(request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error:'Unauthorized' },{status:401});

  const { searchParams } = new URL(request.url);
  const status = searchParams.get('status') || '';
  const limit  = parseInt(searchParams.get('limit') || '200');

  let query = supabase
    .from('ChallanRecords')
    .select('*', { count:'exact' })
    .eq('challan_type', 'internal')
    .order('Challan Number', { ascending: false })
    .limit(limit);

  // Filter by company: internal challans start with INT/
  // We use source_warehouse to associate with a company
  // For simplicity, company is stored in the Challan Number prefix context
  if (status) query = query.eq('status', status);

  const { data, error, count } = await query;
  if (error) return NextResponse.json({ error: error.message },{status:500});
  return NextResponse.json({ data, count });
}

// POST: create internal challan
export async function POST(request) {
  const user = await getCurrentUser();
  if (!user || !['owner','warehouse_employee'].includes(user.role)) {
    return NextResponse.json({ error:'Unauthorized' },{status:401});
  }

  const { sourceWarehouse, destinationLocation, requestedBy, isDisplay,
          products } = await request.json();

  if (!sourceWarehouse || !destinationLocation || !products?.length) {
    return NextResponse.json({ error:'sourceWarehouse, destinationLocation and products required' },{status:400});
  }

  const wh = WAREHOUSE_PREFIXES[sourceWarehouse];
  if (!wh) return NextResponse.json({ error:'Invalid source warehouse' },{status:400});

  const company = getCompany(user.company);
  const now     = new Date();
  const year    = now.getFullYear();
  const month   = now.getMonth() + 1;

  // Get next counter using warehouse-specific key
  const { data: seq, error: cErr } = await supabase
    .rpc('get_next_challan_number', { p_company: wh.key, p_year: year, p_month: month });
  if (cErr) return NextResponse.json({ error: cErr.message },{status:500});

  const mm             = String(month).padStart(2,'0');
  const sss            = String(seq).padStart(3,'0');
  const challanNumber  = `${wh.prefix}/${year}/${mm}/${sss}`;
  const challanDate    = fmtDate(now);
  const pad            = n => String(n).padStart(2,'0');
  const generatedDT    = `${pad(now.getDate())}-${pad(now.getMonth()+1)}-${now.getFullYear()} ${pad(now.getHours())}:${pad(now.getMinutes())}`;

  const productsStr = products
    .map(p => `${p.name}${p.ln_code ? ' ['+p.ln_code+']' : ''} (Rs.${parseFloat(p.price||0).toFixed(2)} x ${p.quantity})`)
    .join('; ');

  const { error: insErr } = await supabase.from('ChallanRecords').insert({
    'Challan Number':      challanNumber,
    'Customer Name':       destinationLocation,  // reuse field for destination
    'Generated DateTime':  generatedDT,
    'Products':            productsStr,
    status:                'awaiting_delivery',
    challan_type:          'internal',
    destination_location:  destinationLocation,
    requested_by:          requestedBy || null,
    is_display:            isDisplay || false,
    source_warehouse:      sourceWarehouse,
    created_by_name:       user.name,
    month_num:             month,
    year_num:              year,
    linked_inventory_ids:  [],
  });
  if (insErr) return NextResponse.json({ error: insErr.message },{status:500});

  // Email notification
  if (company?.defaultEmail) {
    const tableHtml = buildItemsTable(
      ['Product','LN Code','Qty'],
      products.map(p => [p.name, p.ln_code||'—', p.quantity])
    );
    await sendSystemEmail({
      companyEmail: company.defaultEmail,
      companyName:  company.name,
      subject: `Internal Transfer ${challanNumber} — ${sourceWarehouse} → ${destinationLocation}`,
      htmlBody: emailWrapper({
        companyName: company.name,
        title: 'Internal Transfer Challan Created',
        meta: {
          'Challan No':    challanNumber,
          'Date':          challanDate,
          'From':          sourceWarehouse,
          'To':            destinationLocation,
          'Requested by':  requestedBy || '—',
          'Display item':  isDisplay ? 'Yes' : 'No',
          'Created by':    user.name,
        },
        tableHtml,
        footer: 'Automated notification from Challan & Warehouse System',
      }),
    });
  }

  return NextResponse.json({
    ok: true, challanNumber, challanDate, sourceWarehouse,
    destinationLocation, requestedBy, isDisplay, products,
    generatedAt: generatedDT,
  });
}
