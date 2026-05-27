export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { getCurrentUser, canAccess } from '@/lib/auth';

async function extractText(buffer) {
  const { default: pdfParse } = await import('pdf-parse/lib/pdf-parse.js');
  return (await pdfParse(buffer)).text;
}

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

  // Line C: description ends at UOM keyword
  const LINE_C_RE = /^(.+?)(ECH|EA|PKT|NOS|PCS)/;

  // Extract last 3 numbers from end of Line B — anchored to $ so the
  // concatenated mess in the middle doesn't matter.
  // Line B always ends: ...{pkgQty.4dec}{taxableTotal.4dec}{grandTotal.4dec}
  // e.g. "1WON059586/70/094032090426394.000025074.300029587.6800"
  //                                     ^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  //                                     these 3×4-decimal groups at the end
  function extractLineBTotals(lineB) {
    // All three trailing numbers have exactly 4 decimal places
    const m = lineB.match(/(\d+\.\d{4})(\d+\.\d{4})(\d+\.\d{4})$/);
    if (m) {
      return {
        pkgQty:       parseFloat(m[1]),
        taxableTotal: parseFloat(m[2]),
        grandTotal:   parseFloat(m[3]),
      };
    }
    return null;
  }

  const items = [];

  const page1End = lines.findIndex(l => /ANNEXURE/i.test(l) || /Page No\s*-\s*1of2/i.test(l));
  const page1Lines = page1End > 0 ? lines.slice(0, page1End) : lines.slice(0, 65);

  for (let i = 0; i < page1Lines.length - 2; i++) {
    const mA = page1Lines[i].match(LINE_A_RE);
    if (!mA) continue;

    const lineB = page1Lines[i + 1] ?? '';
    if (!lineB.match(LINE_B_RE)) continue;

    const lineC = page1Lines[i + 2] ?? '';
    const mC = lineC.match(LINE_C_RE);
    if (!mC) continue;

    const totals = extractLineBTotals(lineB);
    if (!totals) {
      console.log(`[invoice-parse] Could not extract totals from Line B: ${lineB}`);
      i += 2;
      continue;
    }

    const qtyFromA  = parseFloat(mA[4]);
    const unitPrice = qtyFromA > 0
      ? Math.round((totals.taxableTotal / qtyFromA) * 100) / 100
      : 0;

    const lnCode = ((mA[1] || '') + mA[2] + (mA[3] || '')).trim();
    const desc   = mC[1].trim();

    console.log(`[invoice-parse] ${lnCode} | taxable:${totals.taxableTotal} / qty:${qtyFromA} = ₹${unitPrice}`);

    items.push({
      ln_code:            lnCode,
      product_name:       desc,
      quantity:           Math.max(1, Math.round(qtyFromA)),
      packets_in_product: Math.max(1, Math.round(qtyFromA)),
      price:              unitPrice,
      received:           true,
    });

    i += 2;
  }

  console.log(`[invoice-parse] Invoice: ${invoiceNumber} | Date: ${invoiceDate} | Items: ${items.length}`);

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
