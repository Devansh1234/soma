export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { supabase }     from '@/lib/supabase';

// ── Godrej Invoice Parser (same logic as parse-invoice/route.js) ──────────────
function parseGodrejInvoice(text) {
  const invMatch  = text.match(/Sales Invoice No\s*[:\s]+([\dA-Z\-]+)/i);
  const dateMatch = text.match(/Date\s*[:\s]+(\d{2}-\d{2}-\d{4})/);
  const invoiceNumber = invMatch  ? invMatch[1].replace(/[-\s]/g,'') : 'UNKNOWN';
  const invoiceDate   = dateMatch ? dateMatch[1] : '';

  const mainText = text.split(/ANNEXURE|Page No[\s\-]+2/i)[0];
  const items    = [];
  let m;

  // Strategy A: iText format — LN_CODE first
  const csRe = /([A-Z0-9]+-)?([0-9]{8}[A-Z]{2}[0-9]{5})(\/[A-Z0-9]+)?\s+([\d]+\.[\d]{4})\s+([\d]+\.[\d]{2})\s+[\d.]+%?\s+[\d.]+%?\s+[\d.]+%?\s+\d+\s+[\w\/]+\s+\d+\s+(\d+)\s+[\d,.]+\s+([\d,.]+)\s+[\d,.]+\s+(.+?)\s+(ECH|EA)/gs;
  while ((m = csRe.exec(mainText)) !== null) {
    const qty = parseFloat(m[4]), tax = parseFloat(m[6].replace(/,/g,''));
    items.push({ ln_code:((m[1]||'')+m[2]+(m[3]||'')).trim(), product_name:m[7].replace(/\s+/g,' ').trim(),
                 quantity:Math.max(1,Math.round(qty)), packets_in_product:m[5],
                 price:qty>0&&tax>0?Math.round(tax/qty*100)/100:0 });
  }
  if (items.length) return { invoiceNumber, invoiceDate, items };

  // Strategy B: pdf-parse format — QTY first
  const ppRe = /(\d+\.\d{4})\s+(\d+\.\d{2})\s+[\d.]+%?\s+[\d.]+%?\s+[\d.]+%?\s+\d+\s+(?:[A-Z0-9]+-)?([0-9]{8}[A-Z]{2}[0-9]{5})(?:\/[A-Z0-9]+)?\s+[\w\/]+\s+\d{8}\s+(\d+)\s+[\d,]+\.\d+\s+([\d,]+\.\d+)\s+[\d,]+\.\d+\s+(.+?)\s+(ECH|EA)/gs;
  while ((m = ppRe.exec(mainText)) !== null) {
    const qty = parseFloat(m[1]), tax = parseFloat(m[5].replace(/,/g,''));
    items.push({ ln_code:m[3], product_name:m[6].replace(/\s+/g,' ').trim(),
                 quantity:Math.max(1,Math.round(qty)), packets_in_product:m[4],
                 price:qty>0&&tax>0?Math.round(tax/qty*100)/100:0 });
  }
  return { invoiceNumber, invoiceDate, items };
}

// Detect which company the invoice is addressed to
function detectCompany(text) {
  const t = text.toUpperCase();
  if (t.includes('NALANDA'))                 return 'nalanda';
  if (t.includes('GANGOTRI'))                return 'gangotri';
  if (t.includes('SOMA') || t.includes('WDX001051')) return 'soma';
  return 'soma'; // default
}

// ── Route Handler ──────────────────────────────────────────────────────────────
export async function POST(request) {
  // Authenticate with shared secret (no JWT — called from Google Apps Script)
  const { secret, pdfBase64 } = await request.json();

  const expectedSecret = process.env.GAS_SECRET;
  if (!expectedSecret || secret !== expectedSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!pdfBase64) return NextResponse.json({ error: 'pdfBase64 required' }, { status: 400 });

  try {
    const buffer = Buffer.from(pdfBase64, 'base64');
    const { default: pdfParse } = await import('pdf-parse/lib/pdf-parse.js');
    const { text } = await pdfParse(buffer);

    const result  = parseGodrejInvoice(text);
    const company = detectCompany(text);

    if (!result.items.length) {
      console.error('auto-receive: no items parsed from invoice');
      return NextResponse.json({ error: 'No line items found in PDF', invoiceNumber: result.invoiceNumber }, { status: 422 });
    }

    // Create invoice_uploads record
    const totalQty = result.items.reduce((s,i) => s + i.quantity, 0);
    const { data: upload, error: uploadErr } = await supabase
      .from('invoice_uploads')
      .insert({
        invoice_number: result.invoiceNumber,
        invoice_date:   result.invoiceDate,
        supplier:       'Godrej & Boyce Mfg Co. Ltd.',
        total_items:    totalQty,
        received_items: 0,
        company,
        uploaded_by:    'Gmail Auto-Import',
      })
      .select().single();
    if (uploadErr) throw uploadErr;

    // Save inventory rows as pending_receipt=true (one row per unit per item)
    const now = new Date();
    const inputDate = `${String(now.getDate()).padStart(2,'0')}-${String(now.getMonth()+1).padStart(2,'0')}-${now.getFullYear()}`;
    const rows = [];
    for (const item of result.items) {
      for (let q = 0; q < item.quantity; q++) {
        rows.push({
          product_code:        item.ln_code || null,
          product_name:        item.product_name,
          packets_in_product:  item.packets_in_product || null,
          input_date:          inputDate,
          type_of_entry:       'Invoice',
          price:               item.price || null,
          invoice_number:      result.invoiceNumber,
          invoice_date:        result.invoiceDate,
          status:              'free',
          pending_receipt:     true,
          invoice_upload_id:   upload.id,
          company,
        });
      }
    }

    const { error: invErr } = await supabase.from('inventory').insert(rows);
    if (invErr) throw invErr;

    console.log(`auto-receive: ${result.invoiceNumber} → ${rows.length} items added (pending) for ${company}`);
    return NextResponse.json({
      ok:            true,
      invoiceNumber: result.invoiceNumber,
      invoiceDate:   result.invoiceDate,
      company,
      itemsAdded:    rows.length,
      lineItems:     result.items.length,
    });

  } catch (err) {
    console.error('auto-receive error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
