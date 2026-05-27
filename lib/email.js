// Shared server-side email helper — call from any API route
// All emails go to the company's defaultEmail address

export async function sendSystemEmail({ companyEmail, companyName, subject, htmlBody }) {
  const apiKey    = process.env.ZEPTO_API_KEY;
  const fromEmail = process.env.ZEPTO_FROM_EMAIL || 'noreply@somacompany.in';
  const fromName  = process.env.ZEPTO_FROM_NAME  || 'Challan System';

  if (!apiKey) {
    console.warn('ZEPTO_API_KEY not set — email skipped:', subject);
    return { ok: false, reason: 'ZEPTO_API_KEY not configured' };
  }

  try {
    const res = await fetch('https://api.zeptomail.in/v1.1/email', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': apiKey },
      body: JSON.stringify({
        from: { address: fromEmail },
        to:   [{ email_address: { address: companyEmail, name: companyName } }],
        subject,
        htmlbody: htmlBody,
      }),
    });
    const text = await res.text();
    if (!res.ok) { console.error(`Email failed (${res.status}):`, text); return { ok: false, detail: text }; }
    console.log(`Email sent → ${companyEmail}: ${subject}`);
    return { ok: true };
  } catch (err) {
    console.error('Email network error:', err.message);
    return { ok: false, reason: err.message };
  }
}

// Build a standard table HTML for email bodies
export function buildItemsTable(headers, rows) {
  const ths = headers.map(h => `<th style="padding:6px 10px;border:1px solid #555;text-align:left;background:#333;color:#fff">${h}</th>`).join('');
  const trs = rows.map(r =>
    '<tr>' + r.map(c => `<td style="padding:6px 10px;border:1px solid #ddd">${c ?? '—'}</td>`).join('') + '</tr>'
  ).join('');
  return `<table style="border-collapse:collapse;width:100%;font-family:Arial,sans-serif;font-size:13px">
    <thead><tr>${ths}</tr></thead><tbody>${trs}</tbody></table>`;
}

export function emailWrapper({ companyName, title, meta, tableHtml, footer }) {
  const metaRows = Object.entries(meta).map(([k, v]) =>
    `<tr><td style="padding:4px 8px;font-weight:bold;color:#555;width:160px">${k}</td><td style="padding:4px 8px">${v}</td></tr>`
  ).join('');

  return `<div style="font-family:Arial,sans-serif;font-size:13px;max-width:750px;color:#222">
  <h2 style="margin:0 0 4px">${companyName}</h2>
  <h3 style="margin:0 0 16px;color:#444">${title}</h3>
  <table style="margin-bottom:16px">${metaRows}</table>
  ${tableHtml}
  ${footer ? `<p style="margin-top:16px;font-size:11px;color:#999">${footer}</p>` : ''}
</div>`;
}
