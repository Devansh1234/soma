'use client';
import { useState, useEffect } from 'react';

function StatBox({ label, value, sub, color }) {
  return (
    <div className="card" style={{ padding: '14px 18px', margin: 0, borderLeft: `3px solid ${color || 'var(--border)'}` }}>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 28, fontWeight: 700, color: color || 'var(--text)' }}>{value}</div>
      <div style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--muted)' }}>{label}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 3 }}>{sub}</div>}
    </div>
  );
}

export default function InventoryAnalysisPage() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [challanData, setChallanData] = useState([]);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    const [invRes, challanRes] = await Promise.all([
      fetch('/api/inventory?limit=2000'),
      fetch('/api/challan?limit=500'),
    ]);
    const { data: inv } = await invRes.json();
    const { data: challans } = await challanRes.json();
    setData(inv || []);
    setChallanData(challans || []);
    setLoading(false);
  }

  if (loading) return <div className="page"><div className="spinner" /></div>;

  // Compute stats
  const total = data.length;
  const free = data.filter(i => i.status === 'free').length;
  const committed = data.filter(i => i.status === 'committed').length;
  const dispatched = data.filter(i => i.status === 'dispatched').length;

  const totalValue = data
    .filter(i => i.price && i.status === 'free')
    .reduce((s, i) => s + Number(i.price), 0);

  // By location
  const byLocation = {};
  data.forEach(i => {
    const loc = i.location || 'Unknown';
    if (!byLocation[loc]) byLocation[loc] = { free: 0, committed: 0, dispatched: 0 };
    byLocation[loc][i.status] = (byLocation[loc][i.status] || 0) + 1;
  });

  // Top products by quantity in free stock
  const byProduct = {};
  data.filter(i => i.status === 'free').forEach(i => {
    byProduct[i.product_name] = (byProduct[i.product_name] || 0) + 1;
  });
  const topProducts = Object.entries(byProduct).sort((a, b) => b[1] - a[1]).slice(0, 20);

  // Challans per month (last 6 months)
  const monthMap = {};
  challanData.forEach(c => {
    const raw = c['Order Dated'] || c['Generated DateTime'] || '';
    if (!raw) return;
    const parts = raw.split('-');
    if (parts.length >= 2) {
      const key = parts.slice(0, 2).join('-');
      monthMap[key] = (monthMap[key] || 0) + 1;
    }
  });
  const recentMonths = Object.entries(monthMap).slice(-6);

  return (
    <div className="page">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2 className="page-title" style={{ margin: 0 }}>Inventory Analysis</h2>
        <button className="btn btn-secondary btn-sm" onClick={load}>↻ Refresh</button>
      </div>

      {/* Summary stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12, marginBottom: 24 }}>
        <StatBox label="Total Items" value={total} color="var(--accent)" />
        <StatBox label="Free Stock" value={free} color="var(--success)" sub={`₹${totalValue.toLocaleString('en-IN', { maximumFractionDigits: 0 })} value`} />
        <StatBox label="Committed" value={committed} color="var(--warn)" />
        <StatBox label="Dispatched" value={dispatched} color="var(--muted)" />
        <StatBox label="Total Challans" value={challanData.length} color="var(--accent)" />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>

        {/* By location */}
        <div>
          <h3 style={{ fontSize: 13, fontWeight: 700, marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--muted)' }}>
            Stock by Location
          </h3>
          <table>
            <thead>
              <tr><th>Location</th><th>Free</th><th>Committed</th><th>Dispatched</th><th>Total</th></tr>
            </thead>
            <tbody>
              {Object.entries(byLocation).sort((a, b) => (b[1].free + b[1].committed) - (a[1].free + a[1].committed)).map(([loc, counts]) => (
                <tr key={loc}>
                  <td>{loc}</td>
                  <td style={{ textAlign: 'right', color: 'var(--success)', fontWeight: 600 }}>{counts.free || 0}</td>
                  <td style={{ textAlign: 'right', color: 'var(--warn)' }}>{counts.committed || 0}</td>
                  <td style={{ textAlign: 'right', color: 'var(--muted)' }}>{counts.dispatched || 0}</td>
                  <td style={{ textAlign: 'right', fontWeight: 700 }}>{(counts.free || 0) + (counts.committed || 0) + (counts.dispatched || 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Top products in free stock */}
        <div>
          <h3 style={{ fontSize: 13, fontWeight: 700, marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--muted)' }}>
            Top Free Stock Items
          </h3>
          <table>
            <thead>
              <tr><th>#</th><th>Product</th><th style={{ textAlign: 'right' }}>Qty</th></tr>
            </thead>
            <tbody>
              {topProducts.map(([name, qty], i) => (
                <tr key={i}>
                  <td style={{ color: 'var(--muted)', fontFamily: 'var(--font-mono)', fontSize: 11 }}>{i + 1}</td>
                  <td>{name}</td>
                  <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--success)' }}>{qty}</td>
                </tr>
              ))}
              {topProducts.length === 0 && <tr><td colSpan={3} style={{ color: 'var(--muted)', textAlign: 'center' }}>No free stock</td></tr>}
            </tbody>
          </table>
        </div>

        {/* Challan volume */}
        {recentMonths.length > 0 && (
          <div>
            <h3 style={{ fontSize: 13, fontWeight: 700, marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--muted)' }}>
              Challan Volume (Recent)
            </h3>
            <table>
              <thead><tr><th>Period</th><th style={{ textAlign: 'right' }}>Challans</th></tr></thead>
              <tbody>
                {recentMonths.map(([month, count]) => (
                  <tr key={month}>
                    <td className="mono" style={{ fontSize: 12 }}>{month}</td>
                    <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 700 }}>{count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Items with no price */}
        <div>
          <h3 style={{ fontSize: 13, fontWeight: 700, marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--muted)' }}>
            Items Missing Price
          </h3>
          <table>
            <thead><tr><th>Product</th><th>Status</th><th>Location</th></tr></thead>
            <tbody>
              {data.filter(i => !i.price && i.status !== 'dispatched').slice(0, 20).map((item, i) => (
                <tr key={i}>
                  <td style={{ fontSize: 12 }}>{item.product_name}</td>
                  <td><span className={`badge badge-${item.status}`}>{item.status}</span></td>
                  <td style={{ fontSize: 12, color: 'var(--muted)' }}>{item.location || '—'}</td>
                </tr>
              ))}
              {data.filter(i => !i.price).length === 0 && <tr><td colSpan={3} style={{ color: 'var(--success)', textAlign: 'center' }}>All items have prices ✓</td></tr>}
            </tbody>
          </table>
          {data.filter(i => !i.price && i.status !== 'dispatched').length > 20 && (
            <p style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6 }}>
              + {data.filter(i => !i.price && i.status !== 'dispatched').length - 20} more
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
