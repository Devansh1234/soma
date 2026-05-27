export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { getCurrentUser, canAccess } from '@/lib/auth';

// Replicate iText's LocationTextExtractionStrategy using pdfjs-dist directly.
// Groups text items by Y coordinate (same line) and sorts by X (reading order).
async function extractTextPositional(buffer) {
  // pdfjs-dist v2.x entry point
  const pdfjs = await import('pdfjs-dist/build/pdf.js');
  pdfjs.GlobalWorkerOptions.workerSrc = ''; // No web worker in Node.js

  const doc = await pdfjs.getDocument({
    data: new Uint8Array(buffer),
    useSystemFonts: true,
    verbosity: 0,
  }).promise;

  let fullText = '';
  const Y_TOL = 2; // 2pt tolerance — items within 2pt = same line

  for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
    const page    = await doc.getPage(pageNum);
    const content = await page.getTextContent();

    const lineMap = {};
    for (const item of content.items) {
      if (!item.str?.trim()) continue;
      const yKey = Math.round(item.transform[5] / Y_TOL) * Y_TOL;
      if (!lineMap[yKey]) lineMap[yKey] = [];
      lineMap[yKey].push({ x: item.transform[4], s: item.str });
    }

    // Descending Y = top of page first (PDF origin is bottom-left)
    const ys = Object.keys(lineMap).map(Number).sort((a, b) => b - a);
    for (const y of ys) {
      const line = lineMap[y]
        .sort((a, b) => a.x - b.x)
        .map(i => i.s)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (line) fullText += line + '\n';
    }
    fullText += '\n';
  }

  return fullText;
}

function parseGodrejInvoice(text) {
  const invMatch  = text.match(/Sales Invoice No\s*[:\s]+([\dA-Z\-]+)/i);
  const dateMatch = text.match(/Date\s*[:\s]+(\d{2}-\d{2}-\d{4})/);
  const invoiceNumber = invMatch  ? invMatch[1].replace(/[-\s]/g, '') : 'UNKNOWN';
  const invoiceDate   = dateMatch ? dateMatch[1]                      : '';

  const mainText = text.split(/ANNEXURE|Page No[\s\-]+2/i)[0];

  // Direct port of working C# regex — \s+ handles both same-line and multi-line layouts
  // Groups: 1=prefix  2=baseLN  3=suffix  4=QTY.4dec  5=WEIGHT.2dec
  //         6=SR_NO   7=PACKAGES  8=TAXABLE_TOTAL  9=DESCRIPTION  10=UOM
  const csPat = /([A-Z0-9]+-)?([0-9]{8}[A-Z]{2}[0-9]{5})(\/[A-Z0-9]+)?\s+([\d]+\.[\d]{4})\s+([\d]+\.[\d]{2})\s+[\d.]+%?\s+[\d.]+%?\s+[\d.]+%?\s+(\d+)\s+[\w\/]+\s+\d+\s+(\d+)\s+[\d,.]+\s+([\d,.]+)\s+[\d,.]+\s+(.+?)\s+(ECH|EA)/gs;

  const items = [];
  let m;
  while ((m = csPat.exec(mainText)) !== null) {
    const qty     = parseFloat(m[4]);
    const taxable = parseFloat(m[8].replace(/,/g, ''));
    items.push({
      ln_code:            ((m[1] || '') + m[2] + (m[3] || '')).trim(),
      product_name:       m[9].replace(/\s+/g, ' ').trim(),
      quantity:           Math.max(1, Math.round(qty)),
      packets_in_product: m[7],
      price:              qty > 0 && taxable > 0 ? Math.round(taxable / qty * 100) / 100 : 0,
      received:           true,
    });
  }

  return { invoiceNumber, invoiceDate, items };
}

export async function POST(request) {
  const user = await getCurrentUser();
  if (!user || !canAccess(user, 'warehouse')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const { pdfBase64 } = await request.json();
    if (!pdfBase64) return NextResponse.json({ error: 'pdfBase64 required' }, { status: 400 });

    const buffer = Buffer.from(pdfBase64, 'base64');
    let text;

    try {
      text = await extractTextPositional(buffer);
      console.log('Positional extraction OK');
    } catch (e) {
      console.warn('Positional extraction failed:', e.message, '— using pdf-parse fallback');
      const { default: pdfParse } = await import('pdf-parse/lib/pdf-parse.js');
      text = (await pdfParse(buffer)).text;
    }

    // Log for debugging
    text.split('\n').slice(0, 60).forEach((l, i) => console.log(`L${i}: ${l}`));

    const result = parseGodrejInvoice(text);

    if (!result.items.length) {
      return NextResponse.json({
        error:      'No items found — check Vercel logs',
        debugLines: text.split('\n').slice(0, 60),
      }, { status: 422 });
    }

    return NextResponse.json(result);
  } catch (err) {
    console.error('Parse error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
