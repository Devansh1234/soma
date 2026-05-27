export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { getCurrentUser, canAccess } from '@/lib/auth';

// ─── PDF Text Extraction ─────────────────────────────────────────────────────

async function extractText(buffer) {
  const { default: pdfParse } = await import('pdf-parse/lib/pdf-parse.js');
  const result = await pdfParse(buffer);
  return result.text;
}

// ─── Invoice Parser ───────────────────────────────────────────────────────────

function parseGodrejInvoice(text) {
  const lines = text.split('\n').map(l => l.trimEnd());

  // ── Header ────────────────────────────────────────────────────────────────
  const invoiceNumber = (() => {
    for (const l of lines) {
      // Handles both "Sales Invoice No :10005TI11296003" and "Sales Invoice No :10005TI11296003Date..."
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
  // Each item spans exactly 3 consecutive lines. Actual format from logs:
  //
  // Line A: {LN_CODE}{QTY.4dec}{WEIGHT.2dec}{DISC%}{CGST%}{SGST%}   (all concatenated)
  //   e.g.  30161803SD01996  1.0000  91.00  5.00%9.00%9.00%
  //         56101509SD00493  1.0000  96.80  7.00%9.00%9.00%
  //
  // Line B: {SR_NO}{SALES_ORDER}{HSN}{PKGS?}{BASE_QTY.4dec}{TAXABLE_TOTAL.2dec}{TOTAL_AMT.4dec}
  //   e.g.  1WON059586/70/094032090426394.000025074.300029587.6800
  //
  // Line C: {DESCRIPTION}{UOM}KG{UNIT_WEIGHT}{UNIT_TAXABLE.4dec}{UNIT_TAXABLE.2dec}
  //   e.g.  SNS Comp BWT Cashmere TexECHKG1319.702256.69002256.69

  // Line A: starts with a 15-char LN code, then numbers/percent concatenated
  // The LN code is always [0-9]{8}[A-Z]{2}[0-9]{5}, possibly with a prefix
  const LINE_A_RE = /^([A-Z0-9]+-)?([0-9]{8}[A-Z]{2}[0-9]{5})(\/[A-Z0-9]+)?\s*([\d]+\.[\d]{4})\s*([\d]+\.[\d]{2})/;

  // Line B: starts with digits (Sr No), then sales order, numbers all concatenated
  // We need: TAXABLE_TOTAL which is the 2nd-to-last number before the final 4-decimal
  // Format: {SR}{ORDER}{HSN}{PKGS_or_BASE_QTY as 4dec}{TAXABLE.2dec}{TOTAL.4dec}
  // Looking at L31: 1 WON059586/70/09 40320904 26394.0000 25074.3000 29587.6800
  // The numbers at the end: qty=26394.0000, taxable=25074.3000, total=29587.6800
  // But per-item taxable (from Line C) = 2256.6900 = 25074.30 / qty(1) ... wait qty is 1
  // Actually for item 3 (L36-38): qty=2, taxable total=19113.36, unit=1720.20 → 19113.36/2=9556.68 ≠ 1720.20
  // So unit taxable comes directly from Line C, not computed from Line B
  // We just need packages from Line B
  // L31: "1WON059586/70/094032090426394.000025074.300029587.6800"
  //   SR=1, ORDER=WON059586/70/09, HSN=40320904, then numbers
  // The packages field: looking at the C# code it used groups[8]=packages
  // In Line B the structure is: SR_NO + SALES_ORDER + HSN_CODE + QTY.4dec + TAXABLE.2dec + TOTAL.4dec
  // For item with qty=2: L37: "3WON059587/20/094035090210276.000019113.360022553.7600"
  //   → 10276.0000 is NOT qty=2... the qty is in Line A (2.0000)
  //   → packages would be 2 (from C# Packages field)
  // Let's not extract packages from Line B since it's unreliable - use qty from Line A as packages
  // for single-unit items, and just capture the taxable total for price computation

  // Line B just needs to confirm it's a data line (starts with digit, contains order no)
  const LINE_B_RE = /^(\d+)[A-Z]/; // starts with SR number then uppercase (start of order no)

  // Line C: {DESCRIPTION}{UOM}KG{numbers}
  // UOM is ECH, EA, PKT, NOS etc — always 2-3 uppercase letters before "KG"
  // The unit taxable value is the last repeating number
  // L32: "SNS Comp BWT Cashmere TexECHKG1319.702256.69002256.69"
  //   → desc="SNS Comp BWT Cashmere Tex", uom="ECH", unitTaxable=2256.6900
  // L38: "Kalista V3 2Dr WDB Dor SwisWhECHKG1438.641720.20001720.20"
  //   → desc="Kalista V3 2Dr WDB Dor SwisWh", uom="ECH", unitTaxable=1720.2000
  const LINE_C_RE = /^(.+?)(ECH|EA|PKT|NOS|PCS)KG([\d.]+)([\d.]+)([\d.]+)$/;

  const items = [];

  // Only parse page 1 — stop before annexure
  const page1End = lines.findIndex(l => /ANNEXURE|Page No\s*-?\s*2\s*of/i.test(l));
  const page1Lines = page1End > 0 ? lines.slice(0, page1End) : lines.slice(0, 60);

  for (let i = 0; i < page1Lines.length - 2; i++) {
    const mA = page1Lines[i].match(LINE_A_RE);
    if (!mA) continue;

    // Verify next line starts with a digit (Sr No)
    const mB = page1Lines[i + 1]?.match(LINE_B_RE);
    if (!mB) continue;

    // Line C must contain a UOM marker
    const mC = page1Lines[i + 2]?.match(LINE_C_RE);
    if (!mC) continue;

    const lnCode    = ((mA[1] || '') + mA[2] + (mA[3] || '')).trim();
    const qty       = parseFloat(mA[4]);
    const desc      = mC[1].trim();
    const uom       = mC[2];
    // mC[3]=unit weight, mC[4]=unit taxable (4dec format like 2256.6900), mC[5]=unit taxable (2dec)
    const unitPrice = parseFloat(mC[4]);

    items.push({
      ln_code:            lnCode,
      product_name:       desc,
      quantity:           Math.max(1, Math.round(qty)),
      packets_in_product: Math.max(1, Math.round(qty)), // packages = qty for top-level items
      price:              unitPrice,
      received:           true,
    });

    i += 2; // consumed B and C
  }

  // ── ANNEXURE Items ────────────────────────────────────────────────────────
  //
  // Component (BOM) lines from logs:
  // L77: K26014929/1WON059586/170/010         56101999SD36052Sns Pkt1 Comp Cashmere1.001.00PKT
  // L78: K26014929/1WON059586/170/020         56101999SD11214Sns Pkt2 COMP T B WH1.001.00EA
  //
  // Pattern: starts with shipment ref (K.../N), then order no, then BOM line number (padded spaces),
  // then LN code (15 chars), then description, then qty, then shipped qty, then UOM
  // The LN code [0-9]{8}[A-Z]{2}[0-9]{5} is always present and is our anchor

  // Main item header lines in annexure (L74, L82):
  // "1000-5TI-11296003-13050WON059586/170/0         30161803SD01996SNS Comp BWT Cashmere Tex1.00ECH"
  // These give us the parent item — we use them to look up the unit price from main items

  const ANNEX_LN_RE = /([0-9]{8}[A-Z]{2}[0-9]{5})(.+?)([\d]+\.[\d]{2})([\d]+\.[\d]{2})(ECH|EA|PKT|NOS|PCS)\s*$/;
  const ANNEX_MAIN_LN_RE = /\d{4}-\d[A-Z]{2}-\d+-\d+\s*\d+\s*\S+\s+([0-9]{8}[A-Z]{2}[0-9]{5})/;

  // Build price lookup: parent LN code → unit price
  const priceLookup = {};
  for (const item of items) {
    priceLookup[item.ln_code] = item.price;
  }

  const annexItems = [];
  let inAnnex = false;
  let currentParentPrice = 0;
  let currentParentLn = '';

  for (const l of lines) {
    if (/ANNEXURE/i.test(l)) { inAnnex = true; continue; }
    if (!inAnnex) continue;

    // Detect parent item line to track current price context
    const mMain = l.match(ANNEX_MAIN_LN_RE);
    if (mMain) {
      currentParentLn = mMain[1];
      currentParentPrice = priceLookup[currentParentLn] ?? 0;
      continue;
    }

    // Detect component line
    const mComp = l.match(ANNEX_LN_RE);
    if (!mComp) continue;

    const lnCode      = mComp[1];
    const rawDesc     = mComp[2];
    const shippedQty  = parseFloat(mComp[4]);

    // Description is everything between LN code and the trailing numbers
    // Strip leading/trailing spaces and any trailing digits that bled in
    const desc = rawDesc.replace(/^\s+|\s+$/g, '').replace(/[\d.]+$/, '').trim();

    annexItems.push({
      ln_code:            lnCode,
      product_name:       desc || lnCode,
      quantity:           Math.max(1, Math.round(shippedQty)),
      packets_in_product: 1,
      price:              0, // component items don't have individual prices in Godrej invoices
      received:           true,
    });
  }

  // Return annexure items if present (these are what the receive screen shows),
  // otherwise fall back to main line items
  const finalItems = annexItems.length > 0 ? annexItems : items;

  console.log(`[invoice-parse] Invoice: ${invoiceNumber} | Date: ${invoiceDate} | Main: ${items.length} | Annexure: ${annexItems.length} | Returning: ${finalItems.length}`);

  return { invoiceNumber, invoiceDate, items: finalItems };
}

// ─── POST Handler ─────────────────────────────────────────────────────────────

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
      console.log('[invoice-parse] pdf-parse OK');
    } catch (e) {
      return NextResponse.json({ error: 'PDF extraction failed: ' + e.message }, { status: 500 });
    }

    // Log all lines for debugging
    text.split('\n').forEach((l, i) =>
      console.log(`[invoice-parse] L${String(i).padStart(2, '0')}: ${l}`)
    );

    const result = parseGodrejInvoice(text);

    if (!result.items.length) {
      return NextResponse.json({
        error:         'No items parsed — check Vercel logs',
        invoiceNumber: result.invoiceNumber,
        invoiceDate:   result.invoiceDate,
        debugLines:    text.split('\n').slice(0, 90),
      }, { status: 422 });
    }

    return NextResponse.json(result);

  } catch (err) {
    console.error('[invoice-parse] Unhandled error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
