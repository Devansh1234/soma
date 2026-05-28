export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

function parseGodrejInvoice(text) {
  const invMatch  = text.match(/Sales Invoice No\s*[:\s]+([\dA-Z\-]+)/i);
  const dateMatch = text.match(/Date\s*[:\s]+(\d{2}-\d{2}-\d{4})/);
  const invoiceNumber = invMatch  ? invMatch[1].replace(/[-\s]/g,'') : 'UNKNOWN';
  const invoiceDate   = dateMatch ? dateMatch[1] : '';

  const mainText = text;   // don't split — see full text first
  const items    = [];
  let m;

  // Strategy A: iText format — LN_CODE first
  const csRe = /([A-Z0-9]+-)?([0-9]{8}[A-Z]{2}[0-9]{5})(\/[A-Z0-9]+)?\s+([\d]+\.[\d]{4})\s+([\d]+\.[\d]{2})\s+[\d.]+%?\s+[\d.]+%?\s+[\d.]+%?\s+\d+\s+[\w\/]+\s+\d+\s+(\d+)\s+[\d,.]+\s+([\d,.]+)\s+[\d,.]+\s+(.+?)\s+(ECH|EA)/gs;
  while ((m = csRe.exec(mainText)) !== null) {
    const qty = parseFloat(m[4]), tax = parseFloat(m[6].replace(/,/g,''));
    items.push({ ln_code:((m[1]||'')+m[2]+(m[3]||'')).trim(), product_name:m[7].replace(/\s+/g,' ').trim(),
                 quantity:Math.max(1,Math.round(qty)), packets_in_product:m[5],
                 price:qty>0&&tax>0?Math.round(tax/qty*100)/100:0 });
  }
  if (items.length) return { invoiceNumber, invoiceDate, items, strategy:'A' };

  // Strategy B: pdf-parse format — QTY first, then LN_CODE after SR_NO
  const ppRe = /(\d+\.\d{4})\s+(\d+\.\d{2})\s+[\d.]+%?\s+[\d.]+%?\s+[\d.]+%?\s+\d+\s+(?:[A-Z0-9]+-)?([0-9]{8}[A-Z]{2}[0-9]{5})(?:\/[A-Z0-9]+)?\s+[\w\/]+\s+\d{8}\s+(\d+)\s+[\d,]+\.\d+\s+([\d,]+\.\d+)\s+[\d,]+\.\d+\s+(.+?)\s+(ECH|EA)/gs;
  while ((m = ppRe.exec(mainText)) !== null) {
    const qty = parseFloat(m[1]), tax = parseFloat(m[5].replace(/,/g,''));
    items.push({ ln_code:m[3], product_name:m[6].replace(/\s+/g,' ').trim(),
                 quantity:Math.max(1,Math.round(qty)), packets_in_product:m[4],
                 price:qty>0&&tax>0?Math.round(tax/qty*100)/100:0 });
  }
  if (items.length) return { invoiceNumber, invoiceDate, items, strategy:'B' };

  // Strategy C: LN code context search with 4-decimal qty
  const lnAll = [...mainText.matchAll(/([0-9]{8}[A-Z]{2}[0-9]{5})/g)];
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
                 price:qty>0&&tax>0?Math.round(tax/qty*100)/100:0 });
  }
  if (items.length) return { invoiceNumber, invoiceDate, items, strategy:'C' };

  return { invoiceNumber, invoiceDate, items:[], strategy:'none' };
}

function detectCompany(text) {
  const t = text.toUpperCase();
  if (t.includes('NALANDA'))  return 'nalanda';
  if (t.includes('GANGOTRI')) return 'gangotri';
  return 'soma';
}

export async function POST(request) {
  const { secret, pdfBase64 } = await request.json();

  if (!process.env.GAS_SECRET || secret !== process.env.GAS_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!pdfBase64) return NextResponse.json({ error: 'pdfBase64 required' }, { status: 400 });

  try {
    const buffer = Buffer.from(pdfBase64, 'base64');
    const { default: pdfParse } = await import('pdf-parse/lib/pdf-parse.js');
    const { text } = await pdfParse(buffer);

    const lines    = text.split('\n');
    const lnCount  = (text.match(/[0-9]{8}[A-Z]{2}[0-9]{5}/g)||[]).length;

    // Log everything to Vercel
    console.log(`auto-receive: ${lines.length} lines, ${lnCount} LN codes found`);
    lines.forEach((l,i) => console.log(`L${String(i).padStart(3,'0')}: ${l}`));

    const result  = parseGodrejInvoice(text);
    const company = detectCompany(text);

    if (!result.items.length) {
      // Return debug info so GAS log shows what's happening
      return NextResponse.json({
        error:         'No line items found in PDF',
        invoiceNumber: result.invoiceNumber,
        lnCodesFound:  lnCount,
        totalLines:    lines.length,
        // Lines around where items should be (after header ~line 25)
        sampleLines:   lines.slice(20, 50),
      }, { status: 422 });
    }

    // Save to Supabase
    const totalQty = result.items.reduce((s,i) => s + i.quantity, 0);
    const { data: upload, error: uploadErr } = await supabase
      .from('invoice_uploads')
      .insert({
        invoice_number: result.invoiceNumber,
        invoice_date:   result.invoiceDate,
        supplier:       'Godrej & Boyce Mfg Co. Ltd.',
        total_items:    totalQty,
        received_items: 0,
        company,
        uploaded_by:    'Gmail Auto-Import',
      })
      .select().single();
    if (uploadErr) throw uploadErr;

    const now = new Date();
    const inputDate = `${String(now.getDate()).padStart(2,'0')}-${String(now.getMonth()+1).padStart(2,'0')}-${now.getFullYear()}`;
    const rows = [];
    for (const item of result.items) {
      for (let q = 0; q < item.quantity; q++) {
        rows.push({
          product_code:       item.ln_code || null,
          product_name:       item.product_name,
          packets_in_product: item.packets_in_product || null,
          input_date:         inputDate,
          type_of_entry:      'Invoice',
          price:              item.price || null,
          invoice_number:     result.invoiceNumber,
          invoice_date:       result.invoiceDate,
          status:             'free',
          pending_receipt:    true,
          invoice_upload_id:  upload.id,
          company,
        });
      }
    }

    const { error: invErr } = await supabase.from('inventory').insert(rows);
    if (invErr) throw invErr;

    return NextResponse.json({
      ok: true, invoiceNumber: result.invoiceNumber,
      invoiceDate: result.invoiceDate, company,
      itemsAdded: rows.length, lineItems: result.items.length,
      strategy: result.strategy,
    });

  } catch (err) {
    console.error('auto-receive error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
