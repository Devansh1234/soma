import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { getCompany } from '@/lib/companies';
import { sendSystemEmail, buildItemsTable, emailWrapper } from '@/lib/email';

function parseProductsString(str) {
  if (!str) return [];
  return str.split('; ').map(item => {
    const m = item.match(/^(.+?)(?:\s+\[([A-Z0-9]+)\])?\s+\(Rs\.([\d,]+\.?\d*)\s+x\s+(\d+)\)$/);
    if (m) return { name:m[1], ln_code:m[2]||null, price:parseFloat(m[3].replace(/,/g,'')), quantity:parseInt(m[4]) };
    return { name:item, ln_code:null, price:0, quantity:1 };
  }).filter(p=>p.name.trim());
}

export async function POST(request) {
  const user = await getCurrentUser();
  if (!user || !['owner','warehouse_employee'].includes(user.role)) {
    return NextResponse.json({ error:'Unauthorized' },{status:401});
  }

  const { challanNumber } = await request.json();
  if (!challanNumber) return NextResponse.json({ error:'challanNumber required' },{status:400});

  const { data: challan } = await supabase
    .from('ChallanRecords')
    .select('*')
    .eq('Challan Number', challanNumber)
    .eq('challan_type','internal')
    .maybeSingle();

  if (!challan)             return NextResponse.json({ error:'Internal challan not found' },{status:404});
  if (challan.status==='rtc') return NextResponse.json({ error:'Already released' },{status:400});

  const destination = challan.destination_location;
  const products    = parseProductsString(challan['Products']);
  const warnings    = [];

  // For each product with LN code: change location FIFO (don't dispatch)
  for (const product of products) {
    if (!product.ln_code) continue;
    const needed = product.quantity;

    // Find free items at source warehouse FIFO
    const { data: items } = await supabase
      .from('inventory')
      .select('id')
      .eq('status','free')
      .eq('product_code', product.ln_code)
      .eq('pending_receipt', false)
      .order('created_at',{ ascending:true })
      .limit(needed);

    const found = items?.length || 0;
    if (found > 0) {
      await supabase.from('inventory')
        .update({ location: destination })
        .in('id', items.map(i=>i.id));
    }
    if (found < needed) {
      warnings.push(`${product.ln_code}: needed ${needed}, only ${found} found`);
    }
  }

  // Mark challan as released
  await supabase.from('ChallanRecords')
    .update({ status:'rtc' })
    .eq('Challan Number', challanNumber);

  // Email
  const prefix  = challanNumber.split('/')[0];
  const cMap    = { SCC:'soma', NCC:'nalanda', GEC:'gangotri', INT:'soma' };
  const company = getCompany(cMap[prefix] || user.company);

  if (company?.defaultEmail) {
    const tableHtml = buildItemsTable(
      ['Product','LN Code','Qty','Location Changed To'],
      products.map(p => [p.name, p.ln_code||'—', p.quantity, destination])
    );
    await sendSystemEmail({
      companyEmail: company.defaultEmail,
      companyName:  company.name,
      subject: `Internal Transfer Released — ${challanNumber}${warnings.length?' ⚠ Stock Shortfall':''}`,
      htmlBody: emailWrapper({
        companyName: company.name,
        title: 'Internal Transfer Released',
        meta: {
          'Challan No':    challanNumber,
          'From':          challan.source_warehouse,
          'To':            destination,
          'Requested by':  challan.requested_by || '—',
          'Display item':  challan.is_display ? 'Yes' : 'No',
          'Released by':   user.name,
          'Timestamp':     new Date().toLocaleString('en-IN'),
          ...(warnings.length ? { '⚠ Shortfall': warnings.join(' | ') } : {}),
        },
        tableHtml,
        footer: 'Automated notification from Challan & Warehouse System',
      }),
    });
  }

  return NextResponse.json({ ok:true, warnings });
}
