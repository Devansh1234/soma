export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { getCurrentUser, canAccess } from '@/lib/auth';

function parseGodrejInvoice(text) {
  const invMatch  = text.match(/Sales Invoice No\s*[:\s]+([\dA-Z\-]+)/i);
  const dateMatch = text.match(/Date\s*[:\s]+(\d{2}-\d{2}-\d{4})/);
  const invoiceNumber = invMatch  ? invMatch[1].replace(/[-\s]/g,'') : 'UNKNOWN';
  const invoiceDate   = dateMatch ? dateMatch[1] : '';

  // Use full text — don't cut on Page No/ANNEXURE until we confirm structure
  const mainText = text;
  const items = [];

  // Strategy A: C# / iText format — LN_CODE first
  const csRe = /([A-Z0-9]+-)?([0-9]{8}[A-Z]{2}[0-9]{5})(\/[A-Z0-9]+)?\s+([\d]+\.[\d]{4})\s+([\d]+\.[\d]{2})\s+[\d.]+%?\s+[\d.]+%?\s+[\d.]+%?\s+\d+\s+[\w\/]+\s+\d+\s+(\d+)\s+[\d,.]+\s+([\d,.]+)\s+[\d,.]+\s+(.+?)\s+(ECH|EA)/gs;
  let m;
  while ((m = csRe.exec(mainText)) !== null) {
    const qty = parseFloat(m[4]), tax = parseFloat(m[6].replace(/,/g,''));
    items.push({ ln_code:((m[1]||'')+m[2]+(m[3]||'')).trim(), product_name:m[7].replace(/\s+/g,' ').trim(),
                 quantity:Math.max(1,Math.round(qty)), packets_in_product:m[5],
                 price:qty>0&&tax>0?Math.round(tax/qty*100)/100:0, received:true });
  }
  if (items.length) { console.log(`Strategy A: ${items.length} items`); return { invoiceNumber, invoiceDate, items }; }

  // Strategy B: pdf-parse format — QTY first, LN_CODE after SR_NO
  const ppRe = /(\d+\.\d{4})\s+(\d+\.\d{2})\s+[\d.]+%?\s+[\d.]+%?\s+[\d.]+%?\s+\d+\s+(?:[A-Z0-9]+-)?([0-9]{8}[A-Z]{2}[0-9]{5})(?:\/[A-Z0-9]+)?\s+[\w\/]+\s+\d{8}\s+(\d+)\s+[\d,]+\.\d+\s+([\d,]+\.\d+)\s+[\d,]+\.\d+\s+(.+?)\s+(ECH|EA)/gs;
  while ((m = ppRe.exec(mainText)) !== null) {
    const qty = parseFloat(m[1]), tax = parseFloat(m[5].replace(/,/g,''));
    items.push({ ln_code:m[3], product_name:m[6].replace(/\s+/g,' ').trim(),
                 quantity:Math.max(1,Math.round(qty)), packets_in_product:m[4],
                 price:qty>0&&tax>0?Math.round(tax/qty*100)/100:0, received:true });
  }
  if (items.length) { console.log(`Strategy B: ${items.length} items`); return { invoiceNumber, invoiceDate, items }; }

  // Strategy C: LN code context search
  const lnAll = [...mainText.matchAll(/([0-9]{8}[A-Z]{2}[0-9]{5})/g)];
  console.log(`Strategy C: found ${lnAll.length} LN code occurrences in full text`);
  for (const occ of lnAll) {
    const lnCode = occ[1];
    const before = mainText.substring(Math.max(0,occ.index-200), occ.index);
    const after  = mainText.substring(occ.index+lnCode.length, occ.index+lnCode.length+400);
    const ctx    = (before+' '+after).replace(/\s+/g,' ');
    const qtyM   = ctx.match(/\b(\d{1,3}\.\d{4})\b/);
    const qty    = qtyM ? parseFloat(qtyM[1]) : 1;
    const pkgM   = ctx.match(/\d{8}\s+(\d{1,2})\b/);
    const bigN   = [...ctx.matchAll(/\b([\d,]+\.\d{4})\b/g)].map(n=>parseFloat(n[1].replace(/,/g,''))).filter(n=>n>500&&n<10000000);
    const tax    = bigN.length>=2?bigN[1]:bigN[0]||0;
    const descM  = ctx.match(/([A-Z][A-Za-z0-9\s]{5,}?)\s+(?:ECH|EA)\b/);
    items.push({ ln_code:lnCode, product_name:descM?descM[1].replace(/\s+/g,' ').trim():`Product ${lnCode}`,
                 quantity:Math.max(1,Math.round(qty)), packets_in_product:pkgM?pkgM[1]:'1',
                 price:qty>0&&tax>0?Math.round(tax/qty*100)/100:0, received:true });
  }
  if (items.length) { console.log(`Strategy C: ${items.length} items`); return { invoiceNumber, invoiceDate, items }; }

  return { invoiceNumber, invoiceDate, items:[] };
}

export async function POST(request) {
  const user = await getCurrentUser();
  if (!user || !canAccess(user,'warehouse')) return NextResponse.json({ error:'Unauthorized' },{status:401});
  try {
    const { pdfBase64 } = await request.json();
    if (!pdfBase64) return NextResponse.json({ error:'pdfBase64 required' },{status:400});

    const buffer = Buffer.from(pdfBase64,'base64');
    const { default: pdfParse } = await import('pdf-parse/lib/pdf-parse.js');
    const { text } = await pdfParse(buffer);

    const lines = text.split('\n');
    const lnCount = (text.match(/[0-9]{8}[A-Z]{2}[0-9]{5}/g)||[]).length;

    // Log everything to Vercel
    console.log(`Total lines: ${lines.length}, LN codes found: ${lnCount}`);
    lines.forEach((l,i) => console.log(`L${String(i).padStart(3,'0')}: ${l}`));

    const result = parseGodrejInvoice(text);

    if (!result.items.length) {
      return NextResponse.json({
        error: 'No items found',
        totalLines: lines.length,
        lnCodesInText: lnCount,
        // Show lines around where items should be (after header ~line 25)
        headerEnd: lines.slice(20, 35),
        itemArea:  lines.slice(35, 70),
        fullTextSample: text.substring(text.indexOf('Item Code'), text.indexOf('Item Code')+2000),
      },{status:422});
    }

    return NextResponse.json(result);
  } catch(err) {
    console.error('Parse error:',err);
    return NextResponse.json({ error:err.message },{status:500});
  }
}
