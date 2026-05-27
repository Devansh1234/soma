export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { getCurrentUser, canAccess } from '@/lib/auth';

// ─── PDF Text Extraction ─────────────────────────────────────────────────────
// pdfjs fails on Vercel (no worker bundle). pdf-parse works reliably.

async function extractText(buffer) {
  const { default: pdfParse } = await import('pdf-parse/lib/pdf-parse.js');
  const result = await pdfParse(buffer);
  return result.text;
}

// ─── Main Invoice Parser ─────────────────────────────────────────────────────

function parseGodrejInvoice(text) {
  const lines = text.split('\n');

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

  // ── Line Items (main invoice page, 3-line structure) ──────────────────────
  //
  // The pdf-parse output collapses columns but keeps rows. Each item spans 3 lines:
  //
  // Line A: {LN_CODE}  {QTY.4dec}  {WEIGHT.2dec}  {DISC%}  {CGST%}  {SGST%}
  // Line B: {SR_NO}  {SALES_ORDER}  {HSN}  {PKGS}  {BASE_QTY}  {TAXABLE_TOTAL}  {TOTAL_AMT}
  // Line C: {DESCRIPTION}  {UOM}  KG  {UNIT_WEIGHT}  {UNIT_TAXABLE}  {UNIT_TAXABLE_DUP}
  //
  // Strategy: find Line A by the LN code pattern, then grab B and C immediately after.

  const LN_CODE_RE  = /^([A-Z0-9]+-)?([0-9]{8}[A-Z]{2}[0-9]{5})(\/[A-Z0-9]+)?/;
  const LINE_A_RE   = /^([A-Z0-9]+-)?([0-9]{8}[A-Z]{2}[0-9]{5})(\/[A-Z0-9]+)?\s+([\d]+\.[\d]{4})\s+([\d]+\.[\d]{2})\s+[\d.]+%?\s+[\d.]+%?\s+[\d.]+%?\s*$/;
  const LINE_B_RE   = /^(\d+)\s+\S+\s+\d+\s+(\d+)\s+[\d.]+\s+([\d,.]+)\s+([\d,.]+)\s*$/;
  const LINE_C_RE   = /^(.+?)\s+(ECH|EA|PKT|NOS)\s+KG\s+([\d,.]+)\s+([\d,.]+)\s+([\d,.]+)\s*$/;

  const items = [];

  // Page 1 only — stop at annexure/page 2
  const page1Lines = [];
  for (const l of lines) {
    if (/ANNEXURE|Page No\s*-\s*2/i.test(l)) break;
    page1Lines.push(l.trimEnd());
  }

  for (let i = 0; i < page1Lines.length - 2; i++) {
    const mA = page1Lines[i].match(LINE_A_RE);
    if (!mA) continue;

    const mB = page1Lines[i + 1]?.match(LINE_B_RE);
    const mC = page1Lines[i + 2]?.match(LINE_C_RE);

    if (!mB || !mC) {
      console.log(`[invoice-parse] Line A matched at ${i} but B/C didn't — skipping`);
      console.log(`  A: ${page1Lines[i]}`);
      console.log(`  B: ${page1Lines[i+1]}`);
      console.log(`  C: ${page1Lines[i+2]}`);
      continue;
    }

    const lnCode    = ((mA[1] || '') + mA[2] + (mA[3] || '')).trim();
    const qty       = parseFloat(mA[4]);
    const packages  = parseInt(mB[2], 10);
    const taxable   = parseFloat(mB[3].replace(/,/g, ''));
    const unitPrice = qty > 0 ? Math.round(taxable / qty * 100) / 100 : 0;
    const desc      = mC[1].replace(/\s+/g, ' ').trim();
    const uom       = mC[2];

    items.push({
      ln_code:            lnCode,
      product_name:       desc,
      quantity:           Math.max(1, Math.round(qty)),
      packets_in_product: packages,
      price:              unitPrice,
      received:           true,
    });

    i += 2; // skip lines B and C
  }

  // ── ANNEXURE parser (component/BOM items) ─────────────────────────────────
  //
  // The annexure lists the actual shipped component LN codes — these are
  // what appear in your receive screen. Format (single line):
  //
  // {INVOICE_REF}-{LINE}  {ORDER_NO}  {BOM_LINE}  {LN_CODE}  {DESCRIPTION}  {QTY}  {SHIPPED_QTY}  {UOM}
  //
  // Example:
  // K26014929/1  WON059586/170/0  10  56101999SD36052  Sns Pkt1 Comp Cashmere  1.00  1.00  PKT

  const ANNEX_ITEM_RE = /\S+\/\d+\s+\S+\s+\d+\s+([0-9]{8}[A-Z]{2}[0-9]{5})\s+(.+?)\s+([\d.]+)\s+([\d.]+)\s+(ECH|EA|PKT|NOS)\s*$/;

  const annexItems = [];
  let inAnnex = false;

  // Also capture the main item reference so we can link unit prices
  // Main item line in annexure: "1000-5TI-11296003-1  3050  WON059586/170/0  30161803SD01996  SNS Comp BWT Cashmere Tex  1.00  ECH"
  const ANNEX_MAIN_RE = /\d{4}-\d[A-Z]{2}-\d+\-(\d+)\s+\d+\s+\S+\s+([0-9]{8}[A-Z]{2}[0-9]{5})\s+(.+?)\s+([\d.]+)\s+(ECH|EA|PKT|NOS)/;

  // Build a price lookup from main items
  const priceLookup = {};
  for (const item of items) {
    priceLookup[item.ln_code] = item.price;
  }

  for (const l of lines) {
    if (/ANNEXURE/i.test(l)) { inAnnex = true; continue; }
    if (!inAnnex) continue;

    const mComp = l.match(ANNEX_ITEM_RE);
    if (mComp) {
      annexItems.push({
        ln_code:            mComp[1],
        product_name:       mComp[2].replace(/\s+/g, ' ').trim(),
        quantity:           Math.max(1, Math.round(parseFloat(mComp[4]))),
        packets_in_product: 1,
        price:              0, // component-level prices not in annexure
        received:           true,
      });
    }
  }

  // ── Decide what to return ─────────────────────────────────────────────────
  // The receive screen shows the ANNEXURE items (component LN codes like
  // 56101999SD36052), not the top-level item codes. Return annexure items
  // when present, else fall back to main line items.

  const finalItems = annexItems.length > 0 ? annexItems : items;

  console.log(`[invoice-parse] Main items: ${items.length}, Annexure items: ${annexItems.length}, Returning: ${finalItems.length}`);

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
      console.log('[invoice-parse] pdf-parse extraction OK');
    } catch (e) {
      console.error('[invoice-parse] pdf-parse failed:', e.message);
      return NextResponse.json({ error: 'PDF extraction failed: ' + e.message }, { status: 500 });
    }

    // Debug: log all lines so structure is visible
    text.split('\n').forEach((l, i) => console.log(`[invoice-parse] L${String(i).padStart(2,'0')}: ${l}`));

    const result = parseGodrejInvoice(text);

    if (!result.items.length) {
      return NextResponse.json({
        error:         'No items parsed — check Vercel logs',
        invoiceNumber: result.invoiceNumber,
        invoiceDate:   result.invoiceDate,
        debugLines:    text.split('\n').slice(0, 80),
      }, { status: 422 });
    }

    return NextResponse.json(result);

  } catch (err) {
    console.error('[invoice-parse] Unhandled error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
