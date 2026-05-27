import { NextResponse } from 'next/server';
import { getCurrentUser, canAccess } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { getCompany } from '@/lib/companies';
import { sendSystemEmail, buildItemsTable, emailWrapper } from '@/lib/email';

export async function POST(request) {
  const user = await getCurrentUser();
  if (!user || !canAccess(user, 'warehouse')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { invoiceNumber, invoiceDate, items } = await request.json();
    // items: [{ ln_code, product_name, quantity, packets_in_product, price, received: bool, pending: bool }]
    if (!items?.length) return NextResponse.json({ error: 'No items provided' }, { status: 400 });

    const company = getCompany(user.company);

    // Create invoice_upload record
    const receivedItems = items.filter(i => i.received);
    const pendingItems  = items.filter(i => !i.received);
    const totalQty      = items.reduce((s, i) => s + i.quantity, 0);
    const receivedQty   = receivedItems.reduce((s, i) => s + i.quantity, 0);

    const { data: upload, error: uploadErr } = await supabase
      .from('invoice_uploads')
      .insert({
        invoice_number: invoiceNumber,
        invoice_date:   invoiceDate,
        total_items:    totalQty,
        received_items: receivedQty,
        company:        user.company,
        uploaded_by:    user.name,
      })
      .select()
      .single();

    if (uploadErr) throw uploadErr;

    const now = new Date();
    const inputDate = `${String(now.getDate()).padStart(2,'0')}-${String(now.getMonth()+1).padStart(2,'0')}-${now.getFullYear()}`;

    // Build inventory rows for ALL items (received + pending)
    const rows = [];
    for (const item of items) {
      for (let q = 0; q < item.quantity; q++) {
        rows.push({
          product_code:       item.ln_code     || null,
          product_name:       item.product_name,
          packets_in_product: item.packets_in_product || null,
          input_date:         inputDate,
          type_of_entry:      'Invoice',
          price:              item.price       || null,
          invoice_number:     invoiceNumber,
          invoice_date:       invoiceDate,
          status:             'free',
          pending_receipt:    !item.received,   // true = not yet physically received
          invoice_upload_id:  upload.id,
          company:            user.company,
        });
      }
    }

    const { error: invErr } = await supabase.from('inventory').insert(rows);
    if (invErr) throw invErr;

    // ── Email notification ────────────────────────────────────────────────────
    if (company?.defaultEmail && receivedItems.length > 0) {
      const tableHtml = buildItemsTable(
        ['LN Code', 'Description', 'Qty Received', 'Price (₹)', 'Packages'],
        receivedItems.map(i => [i.ln_code, i.product_name, i.quantity, i.price?.toLocaleString('en-IN') || '—', i.packets_in_product || '—'])
      );
      const pendingNote = pendingItems.length
        ? `<p style="color:#b8600a;margin-top:12px">⚠ ${pendingItems.reduce((s,i)=>s+i.quantity,0)} items marked as <b>pending</b> (not yet physically received). Confirm from Warehouse → Receive Stock → Pending.</p>`
        : '';

      await sendSystemEmail({
        companyEmail: company.defaultEmail,
        companyName:  company.name,
        subject: `Stock Received — Invoice ${invoiceNumber} — ${receivedQty} items`,
        htmlBody: emailWrapper({
          companyName: company.name,
          title: `Invoice Receipt: ${invoiceNumber}`,
          meta: {
            'Invoice No':     invoiceNumber,
            'Invoice Date':   invoiceDate,
            'Received by':    user.name,
            'Items Received': receivedQty,
            'Items Pending':  pendingItems.reduce((s,i)=>s+i.quantity,0),
            'Timestamp':      new Date().toLocaleString('en-IN'),
          },
          tableHtml: tableHtml + pendingNote,
          footer: 'Automated notification from Challan & Warehouse System',
        }),
      });
    }

    return NextResponse.json({
      ok: true,
      uploadId:      upload.id,
      rowsCreated:   rows.length,
      pendingCount:  pendingItems.reduce((s,i)=>s+i.quantity,0),
    });

  } catch (err) {
    console.error('Confirm invoice error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// Mark individual pending items as received
export async function PATCH(request) {
  const user = await getCurrentUser();
  if (!user || !canAccess(user, 'warehouse')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { ids } = await request.json();
  if (!ids?.length) return NextResponse.json({ error: 'ids required' }, { status: 400 });

  const { error } = await supabase
    .from('inventory')
    .update({ pending_receipt: false })
    .in('id', ids)
    .eq('company', user.company);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, confirmed: ids.length });
}
