export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { getCurrentUser, canAccess } from '@/lib/auth';

function parseGodrejInvoice(text) {
  const lines = text.split(/[\n\r]+/).map(l => l.trim()).filter(Boolean);

  const invNoMatch = text.match(/Sales Invoice No\s*[:\s]+([\dA-Z\-]+)/i);
  const dateMatch  = text.match(/Date\s*[:\s]+(\d{2}-\d{2}-\d{4})/);
  const invoiceNumber = invNoMatch ? invNoMatch[1].replace(/[-\s]/g,'') : 'UNKNOWN';
  const invoiceDate   = dateMatch  ? dateMatch[1] : '';

  const LN_PATTERN = /[0-9]{8}[A-Z]{2}[0-9]{5}/g;

  // Deduplicate but track each occurrence (same LN code = multiple items)
  const occurrences = [...text.matchAll(LN_PATTERN)].map(m => ({
    lnCode: m[0],
    offset: m.index,
  }));

  if (occurrences.length === 0) {
    return { invoiceNumber, invoiceDate, items: [],
      _debug: { totalLines: lines.length, first40Lines: lines.slice(0, 40) } };
  }

  // Filter out occurrences in the ANNEXURE/BOM section at end of invoice
  const annexureOffset = text.search(/ANNEXURE|BOM Items/i);
  const mainOccurrences = annexureOffset > 0
    ? occurrences.filter(o => o.offset < annexureOffset)
    : occurrences;

  if (mainOccurrences.length === 0) {
    return { invoiceNumber, invoiceDate, items: [],
      _debug: { note: 'All LN codes were in ANNEXURE section', first40Lines: lines.slice(0, 40) } };
  }

  const items = [];

  for (const { lnCode, offset } of mainOccurrences) {
    // Find the line containing this specific occurrence
    const textBefore = text.substring(0, offset);
    const lineIndex  = textBefore.split('\n').length - 1;
    const lnLine     = lines[lineIndex] || '';

    // Qty: first decimal after LN code on same line
    const afterLN  = lnLine.substring(lnLine.indexOf(lnCode) + lnCode.length);
    const qtyMatch = afterLN.match(/(\d+\.\d+)/);
    const qty      = qtyMatch ? parseFloat(qtyMatch[1]) : 1;

    // Context: next 6 lines
    const ctx = lines.slice(lineIndex + 1, lineIndex + 7);

    // Packages + taxable value
    let packages = 1, taxableTotal = 0;
    for (const cl of ctx) {
      // Try: optional_sr + ORDER + 8digit_HSN + PKGS + BASIC.4 + TAX.4 + TOTAL.4
      const m = cl.match(/\d{8}\s+(\d+)\s+([\d,]+\.\d{4})\s+([\d,]+\.\d{4})\s+([\d,]+\.\d{4})/);
      if (m) { packages = parseInt(m[1])||1; taxableTotal = parseFloat(m[3].replace(/,/g,'')); break; }
      // Fallback: PKGS + 3 large 4-dec amounts
      const m2 = cl.match(/^(\d+)\s+([\d,]+\.\d{4})\s+([\d,]+\.\d{4})\s+([\d,]+\.\d{4})/);
      if (m2 && parseFloat(m2[2]) > 100) { packages=parseInt(m2[1])||1; taxableTotal=parseFloat(m2[3].replace(/,/g,'')); break; }
    }

    const price = qty > 0 && taxableTotal > 0
      ? Math.round(taxableTotal / qty * 100) / 100 : 0;

    // Description: text before ECH/EA UOM marker
    let description = `Product ${lnCode}`;
    for (const cl of ctx) {
      const eIdx = cl.search(/\s+(?:ECH|EA)\s+(?:KG|EA|NOS|PKT)/i);
      if (eIdx > 3) {
        const cand = cl.substring(0, eIdx).trim();
        if (/[A-Za-z]{3,}/.test(cand)) { description = cand; break; }
      }
    }

    items.push({ ln_code:lnCode, product_name:description, quantity:Math.max(1,Math.round(qty)),
                 packets_in_product:String(packages), price, received:true });
  }

  return { invoiceNumber, invoiceDate, items };
}

export async function POST(request) {
  const user = await getCurrentUser();
  if (!user || !canAccess(user,'warehouse')) {
    return NextResponse.json({ error:'Unauthorized' },{ status:401 });
  }
  try {
    const { pdfBase64 } = await request.json();
    if (!pdfBase64) return NextResponse.json({ error:'pdfBase64 required' },{ status:400 });

    const buffer = Buffer.from(pdfBase64,'base64');
    const { default: pdfParse } = await import('pdf-parse/lib/pdf-parse.js');
    const pdfData = await pdfParse(buffer);
    const text    = pdfData.text;

    // Log to Vercel so we can see the raw extraction
    console.log('=== INVOICE PDF LINES (first 60) ===');
    text.split('\n').slice(0,60).forEach((l,i) => console.log(`L${i}: ${l}`));

    const result = parseGodrejInvoice(text);

    if (!result.items.length) {
      return NextResponse.json({
        error: 'No line items found — see debugLines for what was extracted',
        debugLines: text.split('\n').slice(0,60),
        _debug: result._debug,
      },{ status:422 });
    }

    return NextResponse.json(result);
  } catch(err) {
    console.error('Invoice parse error:',err);
    return NextResponse.json({ error:err.message },{ status:500 });
  }
}
