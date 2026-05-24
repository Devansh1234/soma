'use client';
import { useState, useEffect } from 'react';

function useDebounce(v, d = 350) {
  const [dv, setDv] = useState(v);
  useEffect(() => { const t = setTimeout(() => setDv(v), d); return () => clearTimeout(t); }, [v, d]);
  return dv;
}

export default function FreeStockPage() {
  const [items, setItems] = useState([]);
  const [grouped, setGrouped] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [view, setView] = useState('grouped'); // 'grouped' | 'list'
  const [location, setLocation] = useState('');
  const [locations, setLocations] = useState([]);
  const [total, setTotal] = useState(0);
  const debSearch = useDebounce(search);
  const debLocation = useDebounce(location);

  useEffect(() => { load(); }, [debSearch, debLocation]);

  async function load() {
    setLoading(true);
    const params = new URLSearchParams({ status: 'free', limit: '500' });
    if (debSearch) params.set('q', debSearch);
    if (debLocation) params.set('location', debLocation);
    const res = await fetch(`/api/inventory?${params}`);
    const { data, count } = await res.json();
    const inv = data || [];
    setItems(inv);
    setTotal(count || 0);

    // Extract unique locations
    const locs = [...new Set(inv.map(i => i.location).filter(Boolean))].sort();
    setLocations(locs);

    // Group by product_name
    const map = {};
    for (const item of inv) {
      const key = item.product_name;
      if (!map[key]) map[key] = { product_name: key, product_code: item.product_code, count: 0, items: [] };
      map[key].count++;
      map[key].items.push(item);
    }
    setGrouped(Object.values(map).sort((a, b) => a.product_name.localeCompare(b.product_name)));
    setLoading(false);
  }

  return (
    <div className="page">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2 className="page-title" style={{ margin: 0 }}>
          Free Stock
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 400, color: 'var(--muted)', marginLeft: 12 }}>
            {total} items
          </span>
        </h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className={`btn btn-sm ${view === 'grouped' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setView('grouped')}>Grouped</button>
          <button className={`btn btn-sm ${view === 'list' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setView('list')}>List</button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search product…" style={{ maxWidth: 280 }} />
        <select value={location} onChange={e => setLocation(e.target.value)} style={{ maxWidth: 200 }}>
          <option value="">All locations</option>
          {locations.map(l => <option key={l} value={l}>{l}</option>)}
        </select>
        <button className="btn btn-secondary btn-sm" onClick={load}>↻ Refresh</button>
      </div>

      {loading ? <div className="spinner" /> : (
        view === 'grouped' ? (
          <table>
            <thead>
              <tr>
                <th>Product Name</th>
                <th>Product Code</th>
                <th style={{ textAlign: 'right' }}>Available Qty</th>
                <th>Locations</th>
              </tr>
            </thead>
            <tbody>
              {grouped.length === 0 && <tr><td colSpan={4} style={{ textAlign: 'center', color: 'var(--muted)' }}>No free stock found</td></tr>}
              {grouped.map((g, i) => {
                const locs = [...new Set(g.items.map(x => x.location).filter(Boolean))].join(', ');
                return (
                  <tr key={i}>
                    <td style={{ fontWeight: 500 }}>{g.product_name}</td>
                    <td className="mono" style={{ fontSize: 11, color: 'var(--muted)' }}>{g.product_code || '—'}</td>
                    <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--success)' }}>{g.count}</td>
                    <td style={{ fontSize: 12, color: 'var(--muted)' }}>{locs || '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Product Name</th>
                <th>Product Code</th>
                <th>Location</th>
                <th>Price (₹)</th>
                <th>Invoice No.</th>
                <th>Invoice Date</th>
                <th>Input Date</th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 && <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--muted)' }}>No items found</td></tr>}
              {items.map((item, i) => (
                <tr key={i}>
                  <td>{item.product_name}</td>
                  <td className="mono" style={{ fontSize: 11 }}>{item.product_code || '—'}</td>
                  <td>{item.location || '—'}</td>
                  <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)' }}>
                    {item.price ? Number(item.price).toLocaleString('en-IN', { minimumFractionDigits: 2 }) : '—'}
                  </td>
                  <td className="mono" style={{ fontSize: 11 }}>{item.invoice_number || '—'}</td>
                  <td style={{ fontSize: 11, color: 'var(--muted)' }}>{item.invoice_date || '—'}</td>
                  <td style={{ fontSize: 11, color: 'var(--muted)' }}>{item.input_date || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )
      )}
    </div>
  );
}
