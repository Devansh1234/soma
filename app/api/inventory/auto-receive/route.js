export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

// ── Exact same parser as parse-invoice/route.js (confirmed working) ───────────
function parseGodrejInvoice(text) {
  const lines = text.split('\n').map(l => l.trimEnd());

  const invoiceNumber = (() => {
    for (const l of lines) {
      const m = l.match(/Sales Invoice No\s*:\s*([\dA-Z\-]+)/i);
      if (m) return m[1].replace(/[-\s]/g, '');
    }
    return 'UNKNOWN';
  })();

  const invoiceDate = (() => {
    for (const l of lines) {
      const m = l.match(/Date\s*:\s*(\d{2}-\d{2}-\d{4})/);
      if (m) return m[1];
    }
    return '';
  })();

  // Line A: LN code + qty.4dec + weight.2dec
  const LINE_A_RE = /^([A-Z0-9]+-)?([0-9]{8}[A-Z]{2}[0-9]{5})(\/[A-Z0-9]+)?\s*([\d]+\.[\d]{4})\s*([\d]+\.[\d]{2})/;
  // Line B: starts with Sr number then uppercase letter (WON... order)
  const LINE_B_RE = /^\d+[A-Z]/;
  // Line C: description + UOM keyword
  const LINE_C_RE = /^(.+?)(ECH|EA|PKT|NOS|PCS)/;

  function extractLineBTotals(lineB) {
    // Line B always ends with 3 numbers with exactly 4 decimal places:
    // ...pkgQty.4dec  taxableTotal.4dec  grandTotal.4dec
    const m = lineB.match(/(\d+\.\d{4})(\d+\.\d{4})(\d+\.\d{4})$/);
    if (m) return { pkgQty: parseFloat(m[1]), taxableTotal: parseFloat(m[2]), grandTotal: parseFloat(m[3]) };
    return null;
  }

  // Stop before ANNEXURE/BOM section to avoid parsing kit component LN codes
  const page1End = lines.findIndex(l => /ANNEXURE/i.test(l) || /Page No\s*-\s*1of2/i.test(l));
  const workingLines = page1End > 0 ? lines.slice(0, page1End) : lines.slice(0, 65);

  const items = [];
  for (let i = 0; i < workingLines.length - 2; i++) {
    const mA = workingLines[i].match(LINE_A_RE);
    if (!mA) continue;

    const lineB = workingLines[i + 1] ?? '';
    if (!lineB.match(LINE_B_RE)) continue;

    const lineC = workingLines[i + 2] ?? '';
    const mC = lineC.match(LINE_C_RE);
    if (!mC) continue;

    const totals = extractLineBTotals(lineB);
    if (!totals) { i += 2; continue; }

    const qtyFromA  = parseFloat(mA[4]);
    const unitPrice = qtyFromA > 0 ? Math.round((totals.taxableTotal / qtyFromA) * 100) / 100 : 0;
    const lnCode    = ((mA[1] || '') + mA[2] + (mA[3] || '')).trim();
    const desc      = mC[1].trim();

    items.push({
      ln_code:            lnCode,
      product_name:       desc,
      quantity:           Math.max(1, Math.round(qtyFromA)),
      packets_in_product: String(Math.max(1, Math.round(totals.pkgQty))),
      price:              unitPrice,
    });

    i += 2;
  }

  console.log(`[auto-receive] ${invoiceNumber} | ${invoiceDate} | ${items.length} items`);
  return { invoiceNumber, invoiceDate, items };
}

function detectCompany(text) {
  const t = text.toUpperCase();
  if (t.includes('NALANDA'))  return 'nalanda';
  if (t.includes('GANGOTRI')) return 'gangotri';
  return 'soma';
}

// ── Route Handler ──────────────────────────────────────────────────────────────
export async function POST(request) {
  const { secret, pdfBase64 } = await request.json();

  if (!process.env.GAS_SECRET || secret !== process.env.GAS_SECRET) {
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
      return NextResponse.json({
        error: 'No line items found in PDF', invoiceNumber: result.invoiceNumber,
        debugLines: text.split('\n').slice(0, 60),
      }, { status: 422 });
    }

    // Create invoice_uploads record
    const totalQty = result.items.reduce((s, i) => s + i.quantity, 0);
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

    // Save inventory rows (one row per unit, pending_receipt=true)
    const now = new Date();
    const inputDate = `${String(now.getDate()).padStart(2,'0')}-${String(now.getMonth()+1).padStart(2,'0')}-${now.getFullYear()}`;
    const rows = [];
    for (const item of result.items) {
      for (let q = 0; q < item.quantity; q++) {
        rows.push({
          product_code:       item.ln_code || null,
          product_name:       item.product_name,
          packets_in_product: item.packets_in_product || null,
          input_date:         inputDate,
          type_of_entry:      'Invoice',
          price:              item.price || null,
          invoice_number:     result.invoiceNumber,
          invoice_date:       result.invoiceDate,
          status:             'free',
          pending_receipt:    true,
          invoice_upload_id:  upload.id,
          company,
        });
      }
    }

    const { error: invErr } = await supabase.from('inventory').insert(rows);
    if (invErr) throw invErr;

    return NextResponse.json({
      ok: true, invoiceNumber: result.invoiceNumber,
      invoiceDate: result.invoiceDate, company,
      itemsAdded: rows.length, lineItems: result.items.length,
    });

  } catch (err) {
    console.error('[auto-receive] Error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
