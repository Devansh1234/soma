import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';

export async function POST(request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { to, toName, subject, htmlBody, pdfBase64, pdfFilename } = await request.json();

  if (!to || !subject) {
    return NextResponse.json({ error: 'to and subject are required' }, { status: 400 });
  }

  const apiKey    = process.env.ZEPTO_API_KEY;
  const fromEmail = process.env.ZEPTO_FROM_EMAIL || 'noreply@somacompany.in';
  const fromName  = process.env.ZEPTO_FROM_NAME  || 'Challan System';

  if (!apiKey) {
    return NextResponse.json({
      error: 'ZEPTO_API_KEY is not set in .env.local'
    }, { status: 500 });
  }

  // Build payload matching the working C# implementation exactly
  const payload = {
    from: { address: fromEmail },
    to:   [{ email_address: { address: to, name: toName || to } }],
    subject,
    htmlbody: htmlBody || `<p>${subject}</p>`,
  };

  // Attach PDF if provided (matches C# attachments array format)
  if (pdfBase64 && pdfFilename) {
    payload.attachments = [{
      content:   pdfBase64,
      name:      pdfFilename,
      mime_type: 'application/pdf',
    }];
  }

  try {
    const res = await fetch('https://api.zeptomail.in/v1.1/email', {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': apiKey,       // env var should include "Zoho-enczapikey ..." prefix
        'Accept':        'application/json',
      },
      body: JSON.stringify(payload),
    });

    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }

    if (!res.ok) {
      console.error(`ZeptoMail ${res.status}:`, data);
      return NextResponse.json({
        error:  `ZeptoMail returned HTTP ${res.status}`,
        detail: data,
        hint: res.status === 401
          ? 'API key invalid/expired — regenerate at mail.zoho.com'
          : res.status === 422
          ? 'Sender domain not verified in ZeptoMail, or malformed payload'
          : 'Check server logs for detail',
      }, { status: 502 });
    }

    console.log(`Email sent → ${to} (${pdfFilename || 'no attachment'})`);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('Email network error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
