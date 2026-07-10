import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { getCompany } from '@/lib/companies';
import { sendSystemEmail, buildItemsTable, emailWrapper } from '@/lib/email';


function todayDMY() {
  const d = new Date();
  const pad = n => String(n).padStart(2,'0');
  return `${pad(d.getDate())}-${pad(d.getMonth()+1)}-${d.getFullYear()}`;
}

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
  const compId = user.company; // used for newly added inventory rows
  const today  = todayDMY();

  for (const product of products) {
    const needed = product.quantity;

    if (product.ln_code) {
      // Try to find existing free items by LN code
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
          .in('id', items.map(i => i.id));
      }

      const missing = needed - found;
      if (missing > 0) {
        // Item not yet in the system (legacy business) — add it at the destination
        const newRows = Array.from({ length: missing }, () => ({
          product_code:    product.ln_code,
          product_name:    product.name,
          quantity:        1,
          status:          'free',
          location:        destination,
          company:         compId,
          input_date:      today,
          pending_receipt: false,
          not_received:    false,
          type_of_entry:   'internal_transfer',
        }));
        await supabase.from('inventory').insert(newRows);
        warnings.push(`${product.ln_code}: ${missing} unit(s) not found in system — added to inventory at ${destination}`);
      }
    } else {
      // No LN code — add item to inventory at destination so it is tracked
      const newRows = Array.from({ length: needed }, () => ({
        product_code:    null,
        product_name:    product.name,
        quantity:        1,
        status:          'free',
        location:        destination,
        company:         compId,
        input_date:      today,
        pending_receipt: false,
        not_received:    false,
        type_of_entry:   'internal_transfer',
      }));
      await supabase.from('inventory').insert(newRows);
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
