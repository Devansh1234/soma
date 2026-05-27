export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { getCurrentUser, canAccess } from '@/lib/auth';

function parseGodrejInvoice(text) {
  // ── Header ──────────────────────────────────────────────────────────────
  const invNoMatch = text.match(/Sales Invoice No\s*[:\s]+([\dA-Z\-]+)/i);
  const dateMatch  = text.match(/Date\s*[:\s]+(\d{2}-\d{2}-\d{4})/);
  const invoiceNumber = invNoMatch ? invNoMatch[1].replace(/[-\s]/g,'') : 'UNKNOWN';
  const invoiceDate   = dateMatch  ? dateMatch[1] : '';

  // Strip everything from the annexure/page-2 onwards
  const mainText = text.split(/ANNEXURE|Page No[\s\-]+2/i)[0];

  // ── Strategy 1: Direct port of the working C# regex ─────────────────────
  // Uses \s+ so it works whether pdf-parse puts values on one line or many.
  // Groups: 1=prefix 2=base_ln 3=suffix 4=QTY(4dec) 5=WEIGHT 6=SR_NO
  //         7=PACKAGES 8=TAXABLE 9=DESCRIPTION 10=UOM
  const csPattern = /([A-Z0-9]+-)?([0-9]{8}[A-Z]{2}[0-9]{5})(\/[A-Z0-9]+)?\s+([\d]+\.[\d]{4})\s+([\d]+\.[\d]{2})\s+[\d.]+%?\s+[\d.]+%?\s+[\d.]+%?\s+(\d+)\s+[\w\/]+\s+\d+\s+(\d+)\s+[\d,.]+\s+([\d,.]+)\s+[\d,.]+\s+(.+?)\s+(ECH|EA)/gs;

  const items = [];
  let m;
  while ((m = csPattern.exec(mainText)) !== null) {
    const qty     = parseFloat(m[4]);
    const taxable = parseFloat(m[8].replace(/,/g,''));
    const desc    = m[9].replace(/\s+/g,' ').trim();
    items.push({
      ln_code:            ((m[1]||'') + m[2] + (m[3]||'')).trim(),
      product_name:       desc || `Product ${m[2]}`,
      quantity:           Math.max(1, Math.round(qty)),
      packets_in_product: m[7],
      price:              qty > 0 && taxable > 0 ? Math.round(taxable/qty*100)/100 : 0,
      received:           true,
    });
  }

  if (items.length > 0) {
    console.log(`Strategy 1 (C# regex) found ${items.length} items`);
    return { invoiceNumber, invoiceDate, items };
  }

  // ── Strategy 2: Find LN codes, use 4-decimal precision to get qty ────────
  // In Godrej invoices: QTY always has exactly 4 decimal places (1.0000, 2.0000)
  // Discount/CGST/SGST amounts have 2 decimal places — this is the key differentiator
  console.log('Strategy 1 found 0 items, trying Strategy 2...');

  const LN_RE = /[0-9]{8}[A-Z]{2}[0-9]{5}/g;
  const annexureOffset = mainText.search(/ANNEXURE|Page No[\s\-]+2/i);

  const occurrences = [...mainText.matchAll(LN_RE)].filter(o =>
    annexureOffset < 0 || o.index < annexureOffset
  );

  for (const occ of occurrences) {
    const lnCode = occ[0];
    const start  = occ.index;
    // Take 400 chars after the LN code (spans all 3 sub-lines)
    const window = mainText.substring(start, start + 400).replace(/\n/g,' ').replace(/\s+/g,' ');

    // QTY: first number with EXACTLY 4 decimal places (e.g. 1.0000, 2.0000)
    const qtyMatch = window.match(/\b(\d{1,3}\.\d{4})\b/);
    const qty      = qtyMatch ? parseFloat(qtyMatch[1]) : 1;

    // TAXABLE TOTAL: numbers with 4 decimal places in the thousands (e.g. 25074.3000)
    // Typically the 2nd or 3rd 4-decimal number; basic > taxable > total in value
    const fourDecNums = [...window.matchAll(/\b([\d,]+\.\d{4})\b/g)]
      .map(n => parseFloat(n[1].replace(/,/g,'')))
      .filter(n => n > 500); // filter out qty/weight decimals
    // taxable is the second large amount (after basic), so index 1
    const taxable = fourDecNums.length >= 2 ? fourDecNums[1] : fourDecNums[0] || 0;
    const price   = qty > 0 && taxable > 0 ? Math.round(taxable/qty*100)/100 : 0;

    // PACKAGES: small integer (1–99) that appears right after the HSN code (8 digits)
    const pkgsMatch = window.match(/\d{8}\s+(\d{1,2})\b/);
    const packages  = pkgsMatch ? pkgsMatch[1] : '1';

    // DESCRIPTION: text before ECH or EA
    const descMatch = window.match(/([A-Z][A-Za-z0-9\s]{5,}?)\s+(?:ECH|EA)\b/);
    const description = descMatch ? descMatch[1].replace(/\s+/g,' ').trim() : `Product ${lnCode}`;

    items.push({ ln_code:lnCode, product_name:description, quantity:Math.max(1,Math.round(qty)),
                 packets_in_product:packages, price, received:true });
  }

  console.log(`Strategy 2 found ${items.length} items`);
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

    // Log first 80 lines for debugging
    console.log('=== PDF LINES (first 80) ===');
    text.split('\n').slice(0,80).forEach((l,i) => console.log(`L${i}: ${l}`));

    const result = parseGodrejInvoice(text);

    if (!result.items.length) {
      return NextResponse.json({
        error: 'No line items found. Check Vercel logs for raw PDF text.',
        debugLines: text.split('\n').slice(0,60),
      },{ status:422 });
    }

    return NextResponse.json(result);
  } catch(err) {
    console.error('Invoice parse error:',err);
    return NextResponse.json({ error:err.message },{ status:500 });
  }
}
