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

  // Line B: Sr number then uppercase (start of WON... order)
  const LINE_B_RE = /^\d+[A-Z]/;

  // Line C: description ends at UOM keyword
  const LINE_C_RE = /^(.+?)(ECH|EA|PKT|NOS|PCS)/;

  // Extract all decimal numbers from a string using match() — safer than matchAll spread
  function extractDecimals(str) {
    return (str.match(/\d+\.\d+/g) || []).map(Number);
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

    // Get all decimal numbers from Line B
    const nums = extractDecimals(lineB);

    console.log(`[invoice-parse] Line B nums (${nums.length}): ${nums.join(', ')} | line: ${lineB}`);

    if (nums.length < 3) {
      console.log(`[invoice-parse] WARNING: fewer than 3 decimals in Line B, skipping`);
      i += 2;
      continue;
    }

    // Last 3 decimals are always: {pkg_qty.4dec}  {taxable_total.Ndec}  {grand_total.4dec}
    const pkgQty       = nums[nums.length - 3];
    const taxableTotal = nums[nums.length - 2];

    const qtyFromA  = parseFloat(mA[4]);
    const unitPrice = qtyFromA > 0
      ? Math.round((taxableTotal / qtyFromA) * 100) / 100
      : 0;

    const lnCode = ((mA[1] || '') + mA[2] + (mA[3] || '')).trim();
    const desc   = mC[1].trim();

    items.push({
      ln_code:            lnCode,
      product_name:       desc,
      quantity:           Math.max(1, Math.round(qtyFromA)),
      packets_in_product: Math.max(1, Math.round(pkgQty)),
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
