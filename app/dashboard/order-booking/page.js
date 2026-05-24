'use client';
import { useState, useEffect } from 'react';

function useDebounce(v, d = 300) {
  const [dv, setDv] = useState(v);
  useEffect(() => { const t = setTimeout(() => setDv(v), d); return () => clearTimeout(t); }, [v, d]);
  return dv;
}

function ProductSearch({ onAdd }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [show, setShow] = useState(false);
  const debQ = useDebounce(q);

  useEffect(() => {
    if (!debQ) { setResults([]); return; }
    fetch(`/api/products?q=${encodeURIComponent(debQ)}`).then(r => r.json()).then(d => { setResults(d || []); setShow(true); });
  }, [debQ]);

  return (
    <div className="autocomplete-wrap" style={{ maxWidth: 340 }}>
      <input value={q} onChange={e => setQ(e.target.value)} onFocus={() => q && setShow(true)} onBlur={() => setTimeout(() => setShow(false), 150)} placeholder="Search product to add…" />
      {show && results.length > 0 && (
        <div className="autocomplete-list">
          {results.map((r, i) => (
            <div key={i} className="autocomplete-item" onMouseDown={() => { onAdd(r); setQ(''); setShow(false); }}>{r}</div>
          ))}
        </div>
      )}
    </div>
  );
}

const STATUS_CLASS = { booked: 'badge-booked', confirmed: 'badge-confirmed', dispatched: 'badge-dispatched', cancelled: 'badge-cancelled' };

export default function OrderBookingPage() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState([]);
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [tab, setTab] = useState('new'); // 'new' | 'history'

  useEffect(() => { loadOrders(); }, []);

  async function loadOrders() {
    setLoading(true);
    const res = await fetch('/api/orders');
    const data = await res.json();
    setOrders(Array.isArray(data) ? data : []);
    setLoading(false);
  }

  function addItem(name) {
    setItems(prev => {
      const existing = prev.find(i => i.product_name === name);
      if (existing) return prev.map(i => i.product_name === name ? { ...i, quantity: i.quantity + 1 } : i);
      return [...prev, { product_name: name, quantity: 1, price: '' }];
    });
  }

  function updateItem(i, field, val) {
    setItems(prev => prev.map((item, idx) => idx === i ? { ...item, [field]: val } : item));
  }

  function removeItem(i) { setItems(p => p.filter((_, idx) => idx !== i)); }

  async function submitOrder() {
    if (!items.length) { setError('Add at least one product.'); return; }
    setSubmitting(true); setError('');
    const res = await fetch('/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items, notes }),
    });
    setSubmitting(false);
    if (res.ok) {
      setSuccess('Order placed successfully!');
      setItems([]); setNotes('');
      loadOrders();
      setTab('history');
    } else {
      const d = await res.json();
      setError(d.error || 'Failed to place order');
    }
  }

  return (
    <div className="page">
      <h2 className="page-title">Order Booking</h2>

      <div style={{ display: 'flex', gap: 2, marginBottom: 16 }}>
        <button className={`btn btn-sm ${tab === 'new' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setTab('new')}>New Order</button>
        <button className={`btn btn-sm ${tab === 'history' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => { setTab('history'); loadOrders(); }}>
          My Orders ({orders.length})
        </button>
      </div>

      {tab === 'new' && (
        <div style={{ maxWidth: 720 }}>
          {error && <div className="alert alert-error">{error}</div>}
          {success && <div className="alert alert-success">{success}</div>}

          <div className="card">
            <div className="card-title">Add Products</div>
            <ProductSearch onAdd={addItem} />

            {items.length > 0 && (
              <div style={{ marginTop: 14 }}>
                <table>
                  <thead>
                    <tr>
                      <th>Product</th>
                      <th style={{ width: 80 }}>Qty</th>
                      <th style={{ width: 120 }}>Expected Price (₹)</th>
                      <th style={{ width: 40 }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item, i) => (
                      <tr key={i}>
                        <td>{item.product_name}</td>
                        <td>
                          <input type="number" min="1" value={item.quantity} onChange={e => updateItem(i, 'quantity', parseInt(e.target.value) || 1)} style={{ width: 70 }} />
                        </td>
                        <td>
                          <input type="number" min="0" step="0.01" value={item.price} onChange={e => updateItem(i, 'price', e.target.value)} placeholder="Optional" style={{ width: 110 }} />
                        </td>
                        <td>
                          <button onClick={() => removeItem(i)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--danger)', fontSize: 16 }}>×</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {items.length === 0 && (
              <p style={{ color: 'var(--muted)', fontSize: 13, marginTop: 10 }}>Search for products above to add them to your order.</p>
            )}
          </div>

          <div className="card">
            <div className="card-title">Notes (Optional)</div>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3} placeholder="Any special instructions…" />
          </div>

          <button className="btn btn-primary" onClick={submitOrder} disabled={submitting || !items.length}>
            {submitting ? 'Placing Order…' : `Place Order (${items.length} item${items.length !== 1 ? 's' : ''})`}
          </button>
        </div>
      )}

      {tab === 'history' && (
        <div>
          <button className="btn btn-secondary btn-sm" style={{ marginBottom: 12 }} onClick={loadOrders}>↻ Refresh</button>
          {loading ? <div className="spinner" /> : (
            orders.length === 0 ? <p style={{ color: 'var(--muted)' }}>No orders yet.</p> : (
              orders.map(order => (
                <div key={order.id} className="card" style={{ marginBottom: 10 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div>
                      <span className="mono" style={{ fontSize: 12, fontWeight: 700 }}>{order.order_number}</span>
                      <span className={`badge ${STATUS_CLASS[order.status]} `} style={{ marginLeft: 10 }}>{order.status}</span>
                    </div>
                    <span style={{ fontSize: 11, color: 'var(--muted)' }}>
                      {new Date(order.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                    </span>
                  </div>
                  {order.notes && <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 6, marginBottom: 4 }}>Note: {order.notes}</p>}
                  {order.order_items?.length > 0 && (
                    <table style={{ marginTop: 8 }}>
                      <thead><tr><th>Product</th><th>Qty</th><th>Expected Price</th></tr></thead>
                      <tbody>
                        {order.order_items.map((item, i) => (
                          <tr key={i}>
                            <td>{item.product_name}</td>
                            <td>{item.quantity}</td>
                            <td>{item.price ? `₹${Number(item.price).toLocaleString('en-IN')}` : '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              ))
            )
          )}
        </div>
      )}
    </div>
  );
}
