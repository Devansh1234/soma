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
  // Each item spans 3 consecutive lines. Exact format from pdf-parse logs:
  //
  // Line A: {LN_CODE}{QTY.4dec}{WEIGHT.2dec}{DISC%}{CGST%}{SGST%}
  //   L30: 30161803SD019961.000091.005.00%9.00%9.00%
  //   L36: 56101509SD006502.000054.007.00%9.00%9.00%
  //
  // Line B: {SR_NO}{SALES_ORDER}{HSN}{PKG_QTY.4dec}{TAXABLE_TOTAL.4dec}{TOTAL_AMT.4dec}
  //   L31: 1WON059586/70/094032090426394.000025074.300029587.6800
  //   L37: 3WON059587/20/094035090210276.000019113.360022553.7600
  //   The last 3 numbers are always: {line_qty.4dec} {taxable_total.Ndec} {total_amt.4dec}
  //   taxable_total is 2nd from end → divide by qty from Line A = unit price
  //
  // Line C: {DESCRIPTION}{UOM}KG{...numbers concatenated}
  //   L32: SNS Comp BWT Cashmere TexECHKG1319.702256.69002256.69
  //   Numbers are concatenated with no separator — UNRELIABLE for price extraction
  //   Only use Line C for: description and UOM

  // Line A: LN code + qty (4 decimal) + weight (2 decimal) — stop there
  const LINE_A_RE = /^([A-Z0-9]+-)?([0-9]{8}[A-Z]{2}[0-9]{5})(\/[A-Z0-9]+)?\s*([\d]+\.[\d]{4})\s*([\d]+\.[\d]{2})/;

  // Line B: starts with Sr number (digits) then uppercase letter (sales order W...)
  // Extract the LAST THREE number sequences — format is always:
  //   ...{pkg_qty.4dec}{taxable_total.Ndec}{grand_total.4dec}
  // "Ndec" means the taxable total sometimes has 2 or 4 decimal places
  const LINE_B_RE = /^\d+[A-Z]/;
  // Pulls all decimal numbers from Line B — we want the last 3
  const NUMBERS_RE = /\d+\.\d+/g;

  // Line C: description ends where the UOM starts (ECH/EA/PKT/NOS/PCS)
  // Everything before the UOM is the description — ignore numbers after UOM
  const LINE_C_RE = /^(.+?)(ECH|EA|PKT|NOS|PCS)/;

  const items = [];

  // Page 1 only — stop at annexure or footer
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

    // Extract all numbers from Line B, take the last 3
    const allNums = [...lineB.matchAll(NUMBERS_RE)].map(m => parseFloat(m[0]));
    if (allNums.length < 3) {
      console.log(`[invoice-parse] Line B has fewer than 3 numbers, skipping: ${lineB}`);
      i += 2;
      continue;
    }

    // Last 3 numbers: [pkg_qty, taxable_total, grand_total]
    const pkgQty      = allNums[allNums.length - 3];
    const taxableTotal = allNums[allNums.length - 2];
    // grand_total = allNums[allNums.length - 1]  (not needed)

    const qtyFromA  = parseFloat(mA[4]);               // qty from Line A (e.g. 2.0000)
    const packages  = Math.max(1, Math.round(pkgQty)); // packages from Line B
    const unitPrice = qtyFromA > 0
      ? Math.round((taxableTotal / qtyFromA) * 100) / 100
      : 0;

    const lnCode = ((mA[1] || '') + mA[2] + (mA[3] || '')).trim();
    const desc   = mC[1].trim();
    const uom    = mC[2];

    items.push({
      ln_code:            lnCode,
      product_name:       desc,
      quantity:           Math.max(1, Math.round(qtyFromA)),
      packets_in_product: packages,
      price:              unitPrice,
      received:           true,
    });

    i += 2;
  }

  console.log(`[invoice-parse] Invoice: ${invoiceNumber} | Date: ${invoiceDate} | Items: ${items.length}`);
  items.forEach(it =>
    console.log(`[invoice-parse]   ${it.ln_code} | ${it.product_name} | qty:${it.quantity} | pkgs:${it.packets_in_product} | ₹${it.price}`)
  );

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

    // Remove this log block once confirmed stable in production
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
