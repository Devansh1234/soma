'use client';
import { useState, useEffect } from 'react';

function useDebounce(v, d = 350) {
  const [dv, setDv] = useState(v);
  useEffect(() => { const t = setTimeout(() => setDv(v), d); return () => clearTimeout(t); }, [v, d]);
  return dv;
}

export default function FreeStockPage() {
  const [view,      setView]      = useState('grouped'); // 'grouped' | 'list'
  const [items,     setItems]     = useState([]);
  const [total,     setTotal]     = useState(0);
  const [loading,   setLoading]   = useState(true);
  const [search,    setSearch]    = useState('');
  const [location,  setLocation]  = useState('');
  const [locations, setLocations] = useState([]);
  const debSearch = useDebounce(search);

  useEffect(() => { load(); }, [debSearch, location, view]);

  async function load() {
    setLoading(true);
    const params = new URLSearchParams({ status: 'free', limit: '1000', pending: 'false' });
    if (debSearch) params.set('q', debSearch);
    if (location)  params.set('location', location);

    const res  = await fetch(`/api/inventory?${params}`);
    const { data } = await res.json();
    const rows = data || [];

    // Extract unique locations for filter
    setLocations([...new Set(rows.map(r => r.location).filter(Boolean))].sort());

    if (view === 'grouped') {
      // Group by product_code, sum COALESCE(quantity,1)
      // This handles both old model (qty=null, 1 row = 1 unit) and
      // new model (qty=N, 1 row = N units from CSV import)
      const grouped = {};
      for (const row of rows) {
        const key = row.product_code || row.product_name || row.id;
        if (!grouped[key]) {
          grouped[key] = {
            product_code: row.product_code,
            product_name: row.product_name,
            available_qty: 0,
            price: row.price,
            locations: new Set(),
            invoice_number: row.invoice_number,
          };
        }
        grouped[key].available_qty += (row.quantity ?? 1);
        if (row.location) grouped[key].locations.add(row.location);
        // Prefer row with price if current doesn't have one
        if (!grouped[key].price && row.price) grouped[key].price = row.price;
      }

      const result = Object.values(grouped).map(g => ({
        ...g, locations: [...g.locations].join(', ') || '—',
      })).sort((a, b) => (a.product_name || '').localeCompare(b.product_name || ''));

      setItems(result);
      setTotal(result.reduce((s, r) => s + r.available_qty, 0));
    } else {
      // List view — show individual rows, each with its own quantity
      const result = rows.map(r => ({
        ...r,
        available_qty: r.quantity ?? 1,
        locations: r.location || '—',
      })).sort((a, b) => (a.product_name || '').localeCompare(b.product_name || ''));
      setItems(result);
      setTotal(result.reduce((s, r) => s + r.available_qty, 0));
    }

    setLoading(false);
  }

  return (
    <div className="page">
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16 }}>
        <h2 className="page-title" style={{ margin:0 }}>
          Free Stock
          <span style={{ fontSize:13, fontWeight:400, color:'var(--muted)', marginLeft:10 }}>
            {total} unit{total !== 1 ? 's' : ''} · {items.length} product{items.length !== 1 ? 's' : ''}
          </span>
        </h2>
        <div style={{ display:'flex', gap:4 }}>
          <button onClick={() => setView('grouped')}
            className={view==='grouped' ? 'btn btn-primary btn-sm' : 'btn btn-secondary btn-sm'}>
            Grouped
          </button>
          <button onClick={() => setView('list')}
            className={view==='list' ? 'btn btn-primary btn-sm' : 'btn btn-secondary btn-sm'}>
            List
          </button>
        </div>
      </div>

      <div style={{ display:'flex', gap:10, marginBottom:14, flexWrap:'wrap' }}>
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search product…" style={{ maxWidth:260 }} />
        <select value={location} onChange={e => setLocation(e.target.value)} style={{ maxWidth:200 }}>
          <option value="">All locations</option>
          {locations.map(l => <option key={l} value={l}>{l}</option>)}
        </select>
        <button className="btn btn-secondary btn-sm" onClick={load}>↻ Refresh</button>
      </div>

      {loading ? <div className="spinner" /> : (
        <table>
          <thead>
            <tr>
              <th>Product Name</th>
              <th>Product Code (LN)</th>
              <th style={{ textAlign:'right' }}>Available Qty</th>
              <th>Location</th>
              {view === 'list' && <th>Price (₹)</th>}
              {view === 'list' && <th>Invoice No.</th>}
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && (
              <tr><td colSpan={6} style={{ textAlign:'center', color:'var(--muted)', padding:24 }}>
                No free stock found.
              </td></tr>
            )}
            {items.map((item, i) => (
              <tr key={i}>
                <td style={{ fontWeight:500 }}>{item.product_name || '—'}</td>
                <td className="mono" style={{ fontSize:11, color:'var(--muted)' }}>
                  {item.product_code || '—'}
                </td>
                <td style={{ textAlign:'right', fontFamily:'var(--font-mono)', fontSize:13,
                             fontWeight:700, color: item.available_qty > 0 ? 'var(--success)' : 'var(--danger)' }}>
                  {item.available_qty}
                </td>
                <td style={{ fontSize:12, color:'var(--muted)' }}>{item.locations}</td>
                {view === 'list' && (
                  <td style={{ textAlign:'right', fontFamily:'var(--font-mono)', fontSize:12 }}>
                    {item.price ? Number(item.price).toLocaleString('en-IN', { minimumFractionDigits:2 }) : '—'}
                  </td>
                )}
                {view === 'list' && (
                  <td className="mono" style={{ fontSize:11 }}>{item.invoice_number || '—'}</td>
                )}
              </tr>
            ))}
          </tbody>
          {items.length > 0 && (
            <tfoot>
              <tr style={{ borderTop:'2px solid var(--border)', fontWeight:700 }}>
                <td colSpan={2} style={{ textAlign:'right', paddingRight:16, color:'var(--muted)', fontSize:12 }}>Total units:</td>
                <td style={{ textAlign:'right', fontFamily:'var(--font-mono)' }}>{total}</td>
                <td colSpan={view==='list'?3:1} />
              </tr>
            </tfoot>
          )}
        </table>
      )}
    </div>
  );
}
