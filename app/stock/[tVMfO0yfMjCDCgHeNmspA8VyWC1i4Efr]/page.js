// Public read-only stock viewer.
//
// FILE LOCATION:  app/stock/[token]/page.js
// The folder name is literally  [token]  — square brackets included.
// That is Next.js syntax for a dynamic URL segment.
//
// Reached at /stock/<token> where <token> must equal STOCK_PUBLIC_TOKEN
// (set in Vercel → Settings → Environment Variables).
//
// Deliberately server-rendered with NO client JavaScript: search is a plain
// HTML GET form, so it works on very old browsers (the showroom iPad runs
// Safari 9, which has no fetch and no modern JS syntax).
//
// Exposes ONLY product name, LN code and quantity. No prices, no company,
// no invoice numbers, no locations, no customer data.

import { supabase } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Stock Availability',
  robots: { index: false, follow: false },
};

const WRAP = {
  maxWidth: 820,
  margin: '0 auto',
  padding: '18px 14px 60px',
  fontFamily: 'system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif',
  color: '#1a1a1a',
  background: '#f7f7f5',
  minHeight: '100vh',
  WebkitTextSizeAdjust: '100%',
};

export default async function PublicStockPage({ params, searchParams }) {
  const token = process.env.STOCK_PUBLIC_TOKEN;

  // No token configured, or wrong token in the URL → behave as if nothing is here
  if (!token || params?.token !== token) {
    return (
      <div style={WRAP}>
        <h1 style={{ fontSize: 20 }}>Not found</h1>
      </div>
    );
  }

  const search = (searchParams?.q || '').toString().slice(0, 60);

  const { data, error } = await supabase.rpc('public_free_stock', {
    p_search: search || null,
  });

  const rows = data || [];
  const totalUnits = rows.reduce(function (s, r) {
    return s + (Number(r.available_qty) || 0);
  }, 0);

  return (
    <div style={WRAP}>
      <h1 style={{ fontSize: 22, margin: '0 0 2px' }}>Stock Availability</h1>
      <p style={{ fontSize: 13, color: '#666', margin: '0 0 16px' }}>
        {totalUnits} unit{totalUnits === 1 ? '' : 's'} across {rows.length} product{rows.length === 1 ? '' : 's'}
      </p>

      {/* Plain GET form — no JavaScript required */}
      <form method="GET" action="" style={{ marginBottom: 18 }}>
        <input
          type="text"
          name="q"
          defaultValue={search}
          placeholder="Search product or code..."
          style={{
            width: '100%',
            boxSizing: 'border-box',
            fontSize: 17,             // 16px+ stops iOS zooming on focus
            padding: '12px 14px',
            border: '1px solid #ccc',
            borderRadius: 6,
            background: '#fff',
            marginBottom: 8,
          }}
        />
        <button
          type="submit"
          style={{
            fontSize: 16, padding: '11px 22px', border: 'none', borderRadius: 6,
            background: '#1a56db', color: '#fff', fontWeight: 600, cursor: 'pointer',
            WebkitAppearance: 'none',
          }}
        >
          Search
        </button>
        {search ? (
          <a href="?" style={{
            fontSize: 15, marginLeft: 14, color: '#1a56db', textDecoration: 'none',
            display: 'inline-block', padding: '11px 0',
          }}>
            Clear
          </a>
        ) : null}
      </form>

      {error ? (
        <p style={{ color: '#b91c1c', fontSize: 15 }}>
          Unable to load stock right now. Please try again shortly.
        </p>
      ) : rows.length === 0 ? (
        <p style={{ color: '#666', fontSize: 15 }}>
          {search ? 'No matching products in stock.' : 'No stock available.'}
        </p>
      ) : (
        <table style={{
          width: '100%', borderCollapse: 'collapse', background: '#fff',
          border: '1px solid #e2e2df', fontSize: 15,
        }}>
          <thead>
            <tr style={{ background: '#efefec', textAlign: 'left' }}>
              <th style={{ padding: '10px 12px', borderBottom: '1px solid #e2e2df' }}>Product</th>
              <th style={{ padding: '10px 12px', borderBottom: '1px solid #e2e2df', textAlign: 'right', width: 70 }}>Qty</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(function (r, i) {
              return (
                <tr key={i} style={{ background: i % 2 ? '#fafafa' : '#fff' }}>
                  <td style={{ padding: '10px 12px', borderBottom: '1px solid #f0f0ee' }}>
                    <span style={{ display: 'block' }}>{r.product_name || '\u2014'}</span>
                    {r.ln_code ? (
                      <span style={{
                        display: 'block', fontSize: 11, color: '#888',
                        fontFamily: 'ui-monospace, Menlo, Consolas, monospace', marginTop: 2,
                      }}>
                        {r.ln_code}
                      </span>
                    ) : null}
                  </td>
                  <td style={{
                    padding: '10px 12px', borderBottom: '1px solid #f0f0ee',
                    textAlign: 'right', fontWeight: 700,
                    fontFamily: 'ui-monospace, Menlo, Consolas, monospace',
                  }}>
                    {r.available_qty}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <p style={{ fontSize: 11, color: '#999', marginTop: 22, lineHeight: 1.5 }}>
        Availability shown is indicative and may change without notice.
        Please confirm before ordering.
      </p>
    </div>
  );
}
