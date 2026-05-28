'use client';
import { useState, useEffect } from 'react';

function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' }).replace(/ /g,'-');
}

// Single order card — shows all items with SO input fields
function OrderCard({ order, onBook, onCancel, isOwner }) {
  const [soMap,    setSoMap]    = useState(() => {
    const m = {};
    (order.order_items||[]).forEach(i => { m[i.id] = i.so_number || ''; });
    return m;
  });
  const [saving,   setSaving]   = useState(false);
  const [error,    setError]    = useState('');

  const pendingItems = (order.order_items||[]).filter(i => i.status === 'pending_booking');

  async function handleBook() {
    const updates = pendingItems.map(i => ({ id: i.id, so_number: soMap[i.id] || '' }));
    if (updates.some(u => !u.so_number.trim())) { setError('Enter SO numbers for all items before booking.'); return; }
    setError(''); setSaving(true);
    await onBook(order.id, updates);
    setSaving(false);
  }

  return (
    <div className="card" style={{ marginBottom:14 }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:10 }}>
        <div>
          <strong style={{ fontSize:14 }}>{order.retailer_name}</strong>
          <span style={{ fontSize:12, color:'var(--muted)', marginLeft:12 }}>
            Booked on {fmtDate(order.created_at)}
          </span>
          {order.notes && <span style={{ fontSize:12, color:'var(--muted)', marginLeft:10 }}>— {order.notes}</span>}
        </div>
        {isOwner && (
          <button className="btn btn-danger btn-sm" onClick={() => onCancel(order.id)}>Cancel Order</button>
        )}
      </div>

      {error && <div className="alert alert-error" style={{ marginBottom:8 }}>{error}</div>}

      <table>
        <thead>
          <tr>
            <th>Product</th>
            <th>LN Code</th>
            <th>Qty</th>
            <th>SO Number</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {(order.order_items||[]).map(item => (
            <tr key={item.id}>
              <td style={{ fontWeight:500 }}>{item.product_name}</td>
              <td className="mono" style={{ fontSize:11 }}>{item.ln_code || '—'}</td>
              <td style={{ textAlign:'center' }}>{item.ordered_qty}</td>
              <td>
                {item.status === 'pending_booking' ? (
                  <input value={soMap[item.id]||''} onChange={e => setSoMap(m => ({...m,[item.id]:e.target.value}))}
                    placeholder="WON..." style={{ maxWidth:180 }} />
                ) : (
                  <span className="mono" style={{ fontSize:11 }}>{item.so_number || '—'}</span>
                )}
              </td>
              <td>
                <span className={`badge ${item.status === 'pending_booking' ? 'badge-committed' : item.status === 'pending_delivery' ? 'badge-free' : 'badge-confirmed'}`}>
                  {item.status.replace('_',' ')}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {pendingItems.length > 0 && (
        <button className="btn btn-primary" style={{ marginTop:12 }} onClick={handleBook} disabled={saving}>
          {saving ? 'Saving…' : `✓ Mark as Booked (${pendingItems.length} item${pendingItems.length>1?'s':''})`}
        </button>
      )}
    </div>
  );
}

// Flat table for pending delivery and delivered
function FlatTable({ items, columns, renderRow }) {
  return items.length === 0
    ? <p style={{ color:'var(--muted)', fontSize:13 }}>No items.</p>
    : (
      <table>
        <thead><tr>{columns.map(c => <th key={c}>{c}</th>)}</tr></thead>
        <tbody>
          {items.map((item, i) => {
            const cells = renderRow(item);
            return <tr key={i}>{cells.map((c,j) => <td key={j}>{c}</td>)}</tr>;
          })}
        </tbody>
      </table>
    );
}

export default function OrderManagementPage() {
  const [user,    setUser]    = useState(null);
  const [orders,  setOrders]  = useState([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');
  const [success, setSuccess] = useState('');
  const [tab,     setTab]     = useState('pending_booking');

  useEffect(() => {
    fetch('/api/auth/me').then(r=>r.json()).then(u=>setUser(u));
    loadOrders();
  }, []);

  async function loadOrders() {
    setLoading(true);
    const res = await fetch('/api/orders');
    const { data } = await res.json();
    setOrders(data || []);
    setLoading(false);
  }

  async function handleBook(orderId, itemUpdates) {
    setError(''); setSuccess('');
    const res = await fetch('/api/orders/action', {
      method:'PATCH', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ action:'book', orderId, itemUpdates }),
    });
    if (res.ok) { setSuccess('Order items booked — moved to Pending Delivery.'); loadOrders(); }
    else { const d = await res.json(); setError(d.error); }
  }

  async function handleCancel(orderId) {
    if (!confirm('Cancel this order? This cannot be undone.')) return;
    setError(''); setSuccess('');
    const res = await fetch('/api/orders/action', {
      method:'PATCH', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ action:'cancel', orderId }),
    });
    if (res.ok) { setSuccess('Order cancelled.'); loadOrders(); }
    else { const d = await res.json(); setError(d.error); }
  }

  const pendingBooking  = orders.filter(o => o.status === 'pending_booking');
  const pendingDelivery = orders.filter(o => o.status === 'pending_delivery');
  const delivered       = orders.filter(o => o.status === 'delivered');

  const flatItems = (orderList, itemStatus) =>
    orderList.flatMap(o =>
      (o.order_items||[])
        .filter(i => !itemStatus || i.status === itemStatus)
        .map(i => ({ ...i, retailer_name: o.retailer_name, order_created_at: o.created_at }))
    );

  const tabs = [
    ['pending_booking',  'Pending Booking',   pendingBooking.length   || null],
    ['pending_delivery', 'Pending Delivery',  pendingDelivery.length  || null],
    ['delivered',        'Delivered',          null],
  ];

  return (
    <div className="page">
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16 }}>
        <h2 className="page-title" style={{ margin:0 }}>Order Management</h2>
        <button className="btn btn-secondary btn-sm" onClick={loadOrders}>↻ Refresh</button>
      </div>

      {error   && <div className="alert alert-error">{error}</div>}
      {success && <div className="alert alert-success">{success}</div>}

      {/* Tab bar */}
      <div style={{ display:'flex', gap:2, marginBottom:20, borderBottom:'2px solid var(--border)' }}>
        {tabs.map(([key, label, badge]) => (
          <button key={key} onClick={() => setTab(key)}
            style={{ padding:'7px 18px', fontFamily:'var(--font)', fontSize:13,
              fontWeight: tab===key ? 700 : 400, background:'none', border:'none', cursor:'pointer',
              borderBottom: tab===key ? '2px solid var(--accent)' : '2px solid transparent',
              color: tab===key ? 'var(--accent)' : 'var(--muted)', marginBottom:-2 }}>
            {label}
            {badge ? <span style={{ marginLeft:6, background:'var(--warn)', color:'#fff',
              borderRadius:10, padding:'1px 6px', fontSize:11 }}>{badge}</span> : null}
          </button>
        ))}
      </div>

      {loading ? <div className="spinner" /> : (
        <>
          {tab === 'pending_booking' && (
            pendingBooking.length === 0
              ? <p style={{ color:'var(--muted)' }}>No pending bookings.</p>
              : pendingBooking.map(order => (
                  <OrderCard key={order.id} order={order} onBook={handleBook}
                    onCancel={handleCancel} isOwner={user?.role === 'owner'} />
                ))
          )}

          {tab === 'pending_delivery' && (
            <FlatTable
              items={flatItems(pendingDelivery, 'pending_delivery')}
              columns={['Retailer','Product','LN Code','Ordered','Delivered','Remaining','Booked On','SO Number']}
              renderRow={i => [
                <strong>{i.retailer_name}</strong>,
                i.product_name,
                <span className="mono" style={{fontSize:11}}>{i.ln_code||'—'}</span>,
                i.ordered_qty,
                i.delivered_qty,
                <strong style={{color: i.ordered_qty-i.delivered_qty>0 ? 'var(--warn)' : 'var(--success)'}}>
                  {i.ordered_qty - i.delivered_qty}
                </strong>,
                fmtDate(i.booked_at),
                <span className="mono" style={{fontSize:11}}>{i.so_number||'—'}</span>,
              ]}
            />
          )}

          {tab === 'delivered' && (
            <FlatTable
              items={flatItems(delivered, 'delivered')}
              columns={['Retailer','Product','LN Code','Qty','Order Date','SO Number','Challan No.','Bill No.','Delivered Date']}
              renderRow={i => [
                <strong>{i.retailer_name}</strong>,
                i.product_name,
                <span className="mono" style={{fontSize:11}}>{i.ln_code||'—'}</span>,
                i.ordered_qty,
                fmtDate(i.order_created_at),
                <span className="mono" style={{fontSize:11}}>{i.so_number||'—'}</span>,
                <span className="mono" style={{fontSize:10}}>{(i.challan_refs||[]).join(', ')||'—'}</span>,
                <span className="mono" style={{fontSize:10}}>{(i.bill_numbers||[]).join(', ')||'—'}</span>,
                fmtDate(i.delivered_at),
              ]}
            />
          )}
        </>
      )}
    </div>
  );
}
