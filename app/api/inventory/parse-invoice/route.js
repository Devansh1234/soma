export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { getCurrentUser, canAccess } from '@/lib/auth';

// ─── PDF Text Extraction ────────────────────────────────────────────────────

async function extractTextPositional(buffer) {
  // Use the legacy build — works reliably in Node.js / Next.js API routes
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.js');
  // Disable the worker entirely for server-side use
  pdfjs.GlobalWorkerOptions.workerSrc = '';

  const doc = await pdfjs.getDocument({
    data: new Uint8Array(buffer),
    useSystemFonts: true,
    verbosity: 0,
  }).promise;

  let fullText = '';
  const Y_TOL = 2; // 2pt tolerance — items within 2pt treated as same line

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

    // Descending Y = top-of-page first (PDF origin is bottom-left)
    const ys = Object.keys(lineMap).map(Number).sort((a, b) => b - a);
    for (const y of ys) {
      const line = lineMap[y]
        .sort((a, b) => a.x - b.x)
        .map(i => i.s)
        .join(' ')
        .replace(/\s+/g, ' ')   // ← was /\\s+/g — matched literal backslash+s
        .trim();
      if (line) fullText += line + '\n';
    }
    fullText += '\n';
  }

  return fullText;
}

// ─── Invoice Parser ─────────────────────────────────────────────────────────

function parseGodrejInvoice(text) {
  // BUG FIX: All regex backslashes were doubled (\\s, \\d) — in a /regex literal/
  // \\s matches a literal backslash + 's', not whitespace. Fixed to single \s, \d etc.

  const invMatch  = text.match(/Sales Invoice No\s*[:\s]+([\dA-Z\-]+)/i);
  const dateMatch = text.match(/Date\s*[:\s]+(\d{2}-\d{2}-\d{4})/);

  const invoiceNumber = invMatch  ? invMatch[1].replace(/[-\s]/g, '') : 'UNKNOWN';
  const invoiceDate   = dateMatch ? dateMatch[1]                      : '';

  // Only parse page 1 — stops annexure/summary rows from double-matching
  const mainText = text.split(/ANNEXURE|Page No[\s\-]+2/i)[0];

  // ── Line item regex (direct port of working C# pattern) ──────────────────
  //
  // C# pattern groups (1-indexed, as used in C# code):
  //   1  = prefix        e.g. "GI-"        (optional)
  //   2  = base LN code  e.g. "56101509SD00493"
  //   3  = suffix        e.g. "/XYZ"        (optional)
  //   4  = qty           e.g. "1.0000"
  //   5  = weight        e.g. "45.00"
  //   6  = one captured discount/tax field  ← C# captures this as group 6
  //   7  = SrNo
  //   8  = packages
  //   9  = taxable total (the amount to divide by qty for unit price)
  //   10 = description
  //   11 = UOM (ECH|EA)
  //
  // JS groups (0=full match, 1-indexed captures):
  //   Groups 1-5: same as C#
  //   Group  6  → SrNo          (C# group 7) — C# group 6 was a captured field JS keeps non-capturing
  //   Group  7  → packages      (C# group 8)
  //   Group  8  → taxable total (C# group 9)
  //   Group  9  → description   (C# group 10)
  //   Group  10 → UOM           (C# group 11)
  //
  // The key fix: ALL \\d \\s \\w in the original were wrong inside a /regex literal/.

  const linePattern = /([A-Z0-9]+-)?([0-9]{8}[A-Z]{2}[0-9]{5})(\/[A-Z0-9]+)?\s+([\d]+\.[\d]{4})\s+([\d]+\.[\d]{2})\s+[\d.]+%?\s+[\d.]+%?\s+[\d.]+%?\s+(\d+)\s+[\w\/]+\s+\d+\s+(\d+)\s+[\d,.]+\s+([\d,.]+)\s+[\d,.]+\s+(.+?)\s+(ECH|EA)/gs;

  const items = [];
  let m;

  while ((m = linePattern.exec(mainText)) !== null) {
    const prefix = m[1] || '';
    const base   = m[2];
    const suffix = m[3] || '';
    const lnCode = (prefix + base + suffix).trim();

    const qty     = parseFloat(m[4]);
    const taxable = parseFloat(m[8].replace(/,/g, ''));

    // Guard: both must be valid numbers before dividing
    const unitPrice = (qty > 0 && taxable > 0)
      ? Math.round((taxable / qty) * 100) / 100
      : 0;

    items.push({
      ln_code:            lnCode,
      product_name:       m[9].replace(/\s+/g, ' ').trim(),  // ← was /\\s+/g
      quantity:           Math.max(1, Math.round(qty)),
      packets_in_product: parseInt(m[7], 10),
      price:              unitPrice,
      received:           true,
    });
  }

  return { invoiceNumber, invoiceDate, items };
}

// ─── POST Handler ────────────────────────────────────────────────────────────

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
    let extractionMethod = 'unknown';

    // Try positional extraction first (preserves column layout better)
    try {
      text = await extractTextPositional(buffer);
      extractionMethod = 'positional';
      console.log('[invoice-parse] Positional extraction OK');
    } catch (e) {
      console.warn('[invoice-parse] Positional failed:', e.message, '— falling back to pdf-parse');
      try {
        const { default: pdfParse } = await import('pdf-parse/lib/pdf-parse.js');
        text = (await pdfParse(buffer)).text;
        extractionMethod = 'pdf-parse';
        console.log('[invoice-parse] pdf-parse fallback OK');
      } catch (e2) {
        console.error('[invoice-parse] Both extractors failed:', e2.message);
        return NextResponse.json({ error: 'PDF text extraction failed: ' + e2.message }, { status: 500 });
      }
    }

    // Debug: log first 80 lines so you can inspect the raw extracted text
    const debugLines = text.split('\n').slice(0, 80);
    debugLines.forEach((l, i) => console.log(`[invoice-parse] L${String(i).padStart(2,'0')}: ${l}`));

    const result = parseGodrejInvoice(text);

    if (!result.items.length) {
      return NextResponse.json({
        error:           'No line items found — check Vercel logs for raw extracted text',
        invoiceNumber:   result.invoiceNumber,
        invoiceDate:     result.invoiceDate,
        extractionMethod,
        debugLines,      // first 80 lines of extracted text returned for debugging
      }, { status: 422 });
    }

    console.log(`[invoice-parse] Parsed ${result.items.length} items via ${extractionMethod}. Invoice: ${result.invoiceNumber}`);
    return NextResponse.json({ ...result, extractionMethod });

  } catch (err) {
    console.error('[invoice-parse] Unhandled error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
