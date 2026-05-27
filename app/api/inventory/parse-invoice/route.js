export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { getCurrentUser, canAccess } from '@/lib/auth';

async function extractText(buffer) {
  const { default: pdfParse } = await import('pdf-parse/lib/pdf-parse.js');
  return (await pdfParse(buffer)).text;
}

function parseGodrejInvoice(text) {
  const lines = text.split('\n').map(l => l.trimEnd());

  // ── Header ────────────────────────────────────────────────────────────────
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

  // ── Main Line Items ───────────────────────────────────────────────────────
  //
  // Each item = exactly 3 consecutive lines (actual format from pdf-parse):
  //
  // Line A: {LN_CODE}{QTY.4dec}{WEIGHT.2dec}{DISC%}{CGST%}{SGST%}   (no spaces between %)
  //   e.g.  30161803SD01996  1.0000  91.00  5.00%9.00%9.00%
  //
  // Line B: {SR_NO}{SALES_ORDER}{HSN}{QTY_OR_VALUE...}  (all concatenated)
  //   e.g.  1WON059586/70/094032090426394.000025074.300029587.6800
  //
  // Line C: {DESCRIPTION}{UOM}KG{UNIT_WEIGHT}{UNIT_TAXABLE.4dec}{UNIT_TAXABLE.2dec}
  //   e.g.  SNS Comp BWT Cashmere TexECHKG1319.702256.69002256.69

  // Line A: LN code anchor + qty (4dec) + weight (2dec) — ignore rest
  const LINE_A_RE = /^([A-Z0-9]+-)?([0-9]{8}[A-Z]{2}[0-9]{5})(\/[A-Z0-9]+)?\s*([\d]+\.[\d]{4})\s*([\d]+\.[\d]{2})/;

  // Line B: Sr number (digits) immediately followed by uppercase letter (start of sales order "WON...")
  const LINE_B_RE = /^\d+[A-Z]/;

  // Line C: description then UOM then KG then 3 number groups — anchored at end of line
  // UOM options seen: ECH, EA, PKT, NOS, PCS
  const LINE_C_RE = /^(.+?)(ECH|EA|PKT|NOS|PCS)KG([\d.]+)([\d.]+)([\d.]+)$/;

  const items = [];

  // Page 1 only — stop at ANNEXURE or "Page No -1of2" footer
  const page1End = lines.findIndex(l => /ANNEXURE/i.test(l) || /Page No\s*-\s*1of2/i.test(l));
  const page1Lines = page1End > 0 ? lines.slice(0, page1End) : lines.slice(0, 65);

  for (let i = 0; i < page1Lines.length - 2; i++) {
    const mA = page1Lines[i].match(LINE_A_RE);
    if (!mA) continue;

    if (!page1Lines[i + 1]?.match(LINE_B_RE)) continue;

    const mC = page1Lines[i + 2]?.match(LINE_C_RE);
    if (!mC) continue;

    const lnCode    = ((mA[1] || '') + mA[2] + (mA[3] || '')).trim();
    const qty       = parseFloat(mA[4]);
    const desc      = mC[1].trim();
    const uom       = mC[2];
    // mC[4] = the 4-decimal unit taxable value, e.g. "2256.6900" → 2256.69
    const unitPrice = parseFloat(mC[4]);

    items.push({
      ln_code:            lnCode,
      product_name:       desc,
      quantity:           Math.max(1, Math.round(qty)),
      packets_in_product: Math.max(1, Math.round(qty)),
      price:              unitPrice,
      received:           true,
    });

    i += 2; // skip lines B and C, move to next item's Line A
  }

  // ── KEY FIX: always return main items only ────────────────────────────────
  // The annexure is Godrej's internal BOM breakdown (component packets like
  // 56101999SD36052). Your receive screen needs the top-level saleable items
  // (30161803SD01996, 56101509SD00493 etc) — exactly what the main parse gives.
  // The annexure is NEVER used.

  console.log(`[invoice-parse] Invoice: ${invoiceNumber} | Date: ${invoiceDate} | Items: ${items.length}`);
  items.forEach(it => console.log(`[invoice-parse]   ${it.ln_code} | ${it.product_name} | qty:${it.quantity} | ₹${it.price}`));

  return { invoiceNumber, invoiceDate, items };
}

export async function POST(request) {
  const user = await getCurrentUser();
  if (!user || !canAccess(user, 'warehouse')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { pdfBase64 } = await request.json();
    if (!pdfBase64) {
      return NextResponse.json({ error: 'pdfBase64 required' }, { status: 400 });
    }

    const buffer = Buffer.from(pdfBase64, 'base64');
    let text = '';

    try {
      const { default: pdfParse } = await import('pdf-parse/lib/pdf-parse.js');
      text = (await pdfParse(buffer)).text;
    } catch (e) {
      return NextResponse.json({ error: 'PDF extraction failed: ' + e.message }, { status: 500 });
    }

    // Log lines for debugging — remove once stable
    text.split('\n').forEach((l, i) =>
      console.log(`[invoice-parse] L${String(i).padStart(2, '0')}: ${l}`)
    );

    const result = parseGodrejInvoice(text);

    if (!result.items.length) {
      return NextResponse.json({
        error:         'No items parsed — check Vercel logs',
        invoiceNumber: result.invoiceNumber,
        invoiceDate:   result.invoiceDate,
        debugLines:    text.split('\n').slice(0, 60),
      }, { status: 422 });
    }

    return NextResponse.json(result);

  } catch (err) {
    console.error('[invoice-parse] Unhandled error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
