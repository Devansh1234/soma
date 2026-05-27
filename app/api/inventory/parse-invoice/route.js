// Force Node.js runtime — pdf-parse requires it (not Edge compatible)
export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { getCurrentUser, canAccess } from '@/lib/auth';

// ── Godrej Invoice Parser ─────────────────────────────────────────────────────
// Parses the specific Godrej & Boyce Tax Invoice format.
// Each line item spans 3 lines in the extracted text:
//   Line A: {LN_CODE 15chars} {QTY.4dec} {WEIGHT.2dec} {DISC%} {CGST%} {SGST%}
//   Line B: {SR} {SALES_ORDER} {HSN_8digits} {PKGS} {BASIC.4dec} {TAXABLE.4dec} {TOTAL.4dec}
//   Line C: {DESCRIPTION} ECH KG {WEIGHT_KG} {CGST_AMT} {SGST_AMT}

function parseGodrejInvoice(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

  // ── Header ──
  const invNoMatch  = text.match(/Sales Invoice No\s*[:\s]+([\dA-Z-]+)/);
  const dateMatch   = text.match(/Date\s*[:\s]+(\d{2}-\d{2}-\d{4})/);
  const custMatch   = text.match(/Customer Code\/Name\s*[:\s]*([\w]+)/);

  const invoiceNumber = invNoMatch ? invNoMatch[1].replace(/-/g, '') : 'UNKNOWN';
  const invoiceDate   = dateMatch  ? dateMatch[1]                    : '';
  const customerCode  = custMatch  ? custMatch[1]                    : '';

  // ── Line items ──
  const items = [];

  for (let i = 0; i < lines.length; i++) {
    // Line A: starts with 15-char LN code followed by qty
    const lnMatch = lines[i].match(/^([0-9]{8}[A-Z]{2}[0-9]{5})\s+([\d.]+)/);
    if (!lnMatch) continue;

    const lnCode = lnMatch[1];
    const qty    = parseFloat(lnMatch[2]);
    if (isNaN(qty) || qty <= 0) continue;

    // ── Line B: SR ORDER HSN(8) PKGS BASIC.4 TAXABLE.4 TOTAL.4 ──
    const lineB = lines[i + 1] || '';
    // Match: optional_sr  order_no  8digit_hsn  pkgs  basic  taxable  total
    const lineBMatch = lineB.match(
      /\d+\s+\S+\s+(\d{8})\s+(\d+)\s+([\d,]+\.\d+)\s+([\d,]+\.\d+)\s+([\d,]+\.\d+)/
    );
    const packages    = lineBMatch ? parseInt(lineBMatch[2])                       : 1;
    const taxableAmt  = lineBMatch ? parseFloat(lineBMatch[4].replace(/,/g, '')) : 0;
    const pricePerUnit = qty > 0 && taxableAmt > 0
      ? Math.round((taxableAmt / qty) * 100) / 100
      : 0;

    // ── Line C: DESCRIPTION ECH|EA KG ... ──
    const lineC = lines[i + 2] || '';
    const echIdx = lineC.search(/\s+(?:ECH|EA)\s+(?:KG|EA|NOS)/);
    const description = echIdx > 0 ? lineC.substring(0, echIdx).trim() : `Product ${lnCode}`;

    // Each unit of qty becomes a separate reviewable item in the UI
    // (but we represent them as one row with qty field in review;
    //  on confirmation, qty individual inventory rows are created)
    items.push({
      ln_code:           lnCode,
      product_name:      description,
      quantity:          Math.max(1, Math.round(qty)),
      packets_in_product: String(packages),
      price:             pricePerUnit,
      received:          true,   // default checked; user can uncheck
    });
  }

  return { invoiceNumber, invoiceDate, customerCode, items };
}

// ── Route Handler ─────────────────────────────────────────────────────────────
export async function POST(request) {
  const user = await getCurrentUser();
  if (!user || !canAccess(user, 'warehouse')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { pdfBase64 } = await request.json();
    if (!pdfBase64) return NextResponse.json({ error: 'pdfBase64 required' }, { status: 400 });

    const buffer = Buffer.from(pdfBase64, 'base64');

    // Use lib path to avoid pdf-parse's test-file check in Next.js
    const { default: pdfParse } = await import('pdf-parse/lib/pdf-parse.js');
    const pdfData = await pdfParse(buffer);

    const result = parseGodrejInvoice(pdfData.text);

    if (!result.items.length) {
      return NextResponse.json({
        error: 'No line items found. Ensure this is a Godrej & Boyce Tax Invoice.',
        rawTextPreview: pdfData.text.substring(0, 500),
      }, { status: 422 });
    }

    return NextResponse.json(result);
  } catch (err) {
    console.error('Invoice parse error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
