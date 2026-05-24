'use client';
import { useState, useEffect } from 'react';

const STATUS_CLASS = { booked: 'badge-booked', confirmed: 'badge-confirmed', dispatched: 'badge-dispatched', cancelled: 'badge-cancelled' };
const TRANSITIONS = {
  booked: ['confirmed', 'cancelled'],
  confirmed: ['dispatched', 'cancelled'],
  dispatched: [],
  cancelled: [],
};

function OrderRow({ order, onAction }) {
  const [open, setOpen] = useState(false);
  const actions = TRANSITIONS[order.status] || [];

  return (
    <>
      <tr style={{ cursor: 'pointer' }} onClick={() => setOpen(v => !v)}>
        <td className="mono" style={{ fontSize: 11 }}>{order.order_number}</td>
        <td>{order.retailer_name || '—'}</td>
        <td><span className={`badge ${STATUS_CLASS[order.status]}`}>{order.status}</span></td>
        <td style={{ fontSize: 11 }}>
          {order.order_items?.length || 0} item(s)
        </td>
        <td style={{ fontSize: 11, color: 'var(--muted)' }}>
          {new Date(order.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
        </td>
        <td onClick={e => e.stopPropagation()}>
          {actions.map(a => (
            <button key={a} className={`btn btn-sm ${a === 'cancelled' ? 'btn-danger' : 'btn-primary'}`} style={{ marginRight: 4 }} onClick={() => onAction(order.id, a)}>
              {a === 'confirmed' ? 'Confirm' : a === 'dispatched' ? 'Dispatch' : 'Cancel'}
            </button>
          ))}
        </td>
      </tr>
      {open && (
        <tr>
          <td colSpan={6} style={{ background: '#fafaf8', padding: '12px 16px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <div>
                <strong style={{ fontSize: 12 }}>Items</strong>
                <table style={{ marginTop: 6 }}>
                  <thead><tr><th>Product</th><th>Qty</th><th>Price</th><th>Inv. Item</th></tr></thead>
                  <tbody>
                    {(order.order_items || []).map((item, i) => (
                      <tr key={i}>
                        <td>{item.product_name}</td>
                        <td>{item.quantity}</td>
                        <td>{item.price ? `₹${Number(item.price).toLocaleString('en-IN')}` : '—'}</td>
                        <td style={{ fontSize: 11, color: 'var(--muted)' }}>{item.inventory_item_id ? '✓ Linked' : 'Unlinked'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div>
                {order.notes && <p style={{ fontSize: 12 }}><strong>Notes:</strong> {order.notes}</p>}
                <p style={{ fontSize: 11, color: 'var(--muted)' }}>
                  Order ID: <span className="mono">{order.id}</span>
                </p>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

export default function OrderManagementPage() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => { load(); }, [statusFilter]);

  async function load() {
    setLoading(true);
    const params = new URLSearchParams();
    if (statusFilter) params.set('status', statusFilter);
    const res = await fetch(`/api/orders?${params}`);
    const data = await res.json();
    setOrders(Array.isArray(data) ? data : []);
    setLoading(false);
  }

  async function handleAction(id, status) {
    const label = { confirmed: 'Confirm', dispatched: 'Dispatch', cancelled: 'Cancel' }[status];
    if (!confirm(`${label} this order?`)) return;
    const res = await fetch('/api/orders', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, status }),
    });
    if (res.ok) { setSuccess(`Order ${status}.`); load(); }
    else { const d = await res.json(); setError(d.error); }
  }

  const filtered = orders.filter(o =>
    !search || o.order_number?.toLowerCase().includes(search.toLowerCase()) || o.retailer_name?.toLowerCase().includes(search.toLowerCase())
  );

  const counts = orders.reduce((a, o) => { a[o.status] = (a[o.status] || 0) + 1; return a; }, {});

  return (
    <div className="page">
      <h2 className="page-title">Order Management</h2>

      {/* Summary */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
        {['booked', 'confirmed', 'dispatched', 'cancelled'].map(s => (
          <div key={s} className="card" style={{ padding: '10px 16px', margin: 0, flex: 1, textAlign: 'center' }}>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 22, fontWeight: 700 }}>{counts[s] || 0}</div>
            <div style={{ fontSize: 11, textTransform: 'uppercase', color: 'var(--muted)', letterSpacing: '0.05em' }}>{s}</div>
          </div>
        ))}
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {success && <div className="alert alert-success">{success}</div>}

      {/* Filters */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search order no. or retailer…" style={{ maxWidth: 260 }} />
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={{ maxWidth: 160 }}>
          <option value="">All statuses</option>
          <option value="booked">Booked</option>
          <option value="confirmed">Confirmed</option>
          <option value="dispatched">Dispatched</option>
          <option value="cancelled">Cancelled</option>
        </select>
        <button className="btn btn-secondary btn-sm" onClick={load}>↻ Refresh</button>
      </div>

      {loading ? <div className="spinner" /> : (
        <table>
          <thead>
            <tr>
              <th>Order No.</th>
              <th>Retailer</th>
              <th>Status</th>
              <th>Items</th>
              <th>Placed At</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--muted)' }}>No orders found</td></tr>
            )}
            {filtered.map(order => (
              <OrderRow key={order.id} order={order} onAction={handleAction} />
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
