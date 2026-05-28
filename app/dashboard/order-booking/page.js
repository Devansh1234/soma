'use client';
import { useState, useEffect } from 'react';

function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' }).replace(/ /g,'-');
}

export default function OrderBookingPage() {
  const [user,        setUser]        = useState(null);
  const [cart,        setCart]        = useState([]);
  const [form,        setForm]        = useState({ product_name:'', ln_code:'', quantity:'' });
  const [formError,   setFormError]   = useState('');
  const [submitting,  setSubmitting]  = useState(false);
  const [success,     setSuccess]     = useState('');
  const [orders,      setOrders]      = useState([]);
  const [loadingOrders, setLO]        = useState(true);
  const [selectedRow, setSelectedRow] = useState(null);

  useEffect(() => {
    fetch('/api/auth/me').then(r=>r.json()).then(u=>setUser(u));
    loadOrders();
  }, []);

  async function loadOrders() {
    setLO(true);
    const res = await fetch('/api/orders');
    const { data } = await res.json();
    setOrders(data || []);
    setLO(false);
  }

  function addToCart() {
    if (!form.product_name.trim()) { setFormError('Item Name is required.'); return; }
    if (!form.ln_code.trim())      { setFormError('LN Code is required.'); return; }
    if (!form.quantity || parseInt(form.quantity) < 1) { setFormError('Quantity must be at least 1.'); return; }
    setFormError('');
    setCart(c => [...c, { product_name: form.product_name.trim(), ln_code: form.ln_code.trim().toUpperCase(), quantity: parseInt(form.quantity) }]);
    setForm({ product_name:'', ln_code:'', quantity:'' });
  }

  function deleteRow() {
    if (selectedRow === null) return;
    setCart(c => c.filter((_,i) => i !== selectedRow));
    setSelectedRow(null);
  }

  async function completeBooking() {
    if (!cart.length) { setFormError('Add at least one item before completing.'); return; }
    setSubmitting(true); setFormError(''); setSuccess('');
    const res = await fetch('/api/orders', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: cart }),
    });
    setSubmitting(false);
    if (res.ok) {
      setSuccess('Order submitted successfully! We will be in touch.');
      setCart([]);
      setSelectedRow(null);
      loadOrders();
    } else {
      const d = await res.json();
      setFormError(d.error || 'Submission failed.');
    }
  }

  // Split orders into 3 buckets
  const pendingBooking  = orders.filter(o => o.status === 'pending_booking');
  const pendingDelivery = orders.filter(o => o.status === 'pending_delivery');
  const delivered       = orders.filter(o => o.status === 'delivered');

  // Flatten order_items for display in tables
  const flatItems = (orderList, itemStatus) =>
    orderList.flatMap(o =>
      (o.order_items || [])
        .filter(i => !itemStatus || i.status === itemStatus)
        .map(i => ({ ...i, order_created_at: o.created_at }))
    );

  return (
    <div className="page">
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:20 }}>
        <h2 className="page-title" style={{ margin:0 }}>Order Booking</h2>
        {user && <span style={{ fontSize:14, fontWeight:600, color:'var(--text)' }}>{user.name}</span>}
      </div>

      {formError && <div className="alert alert-error">{formError}</div>}
      {success   && <div className="alert alert-success">{success}</div>}

      {/* Form + Cart */}
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1.4fr', gap:24, marginBottom:32 }}>
        {/* Left: input form */}
        <div>
          <div className="form-group">
            <label>Item Name *</label>
            <input value={form.product_name} onChange={e=>setForm(p=>({...p,product_name:e.target.value}))}
              placeholder="e.g. Kalista V2 2D WDB" style={{ border: formError&&!form.product_name.trim() ? '1.5px solid var(--danger)' : undefined }} />
          </div>
          <div className="form-group">
            <label>LN Code *</label>
            <input value={form.ln_code} onChange={e=>setForm(p=>({...p,ln_code:e.target.value}))}
              placeholder="e.g. 56101509SD00493" style={{ border: formError&&!form.ln_code.trim() ? '1.5px solid var(--danger)' : undefined }} />
          </div>
          <div className="form-group">
            <label>Quantity *</label>
            <input type="number" min={1} value={form.quantity} onChange={e=>setForm(p=>({...p,quantity:e.target.value}))}
              placeholder="1" style={{ border: formError&&(!form.quantity||parseInt(form.quantity)<1) ? '1.5px solid var(--danger)' : undefined }} />
          </div>
          <div style={{ display:'flex', gap:10, marginTop:8 }}>
            <button className="btn btn-secondary" onClick={addToCart}>+ Add to Booking</button>
            <button className="btn btn-secondary" onClick={deleteRow} disabled={selectedRow===null}>
              Delete Row
            </button>
          </div>
          <button className="btn btn-primary" style={{ marginTop:20, width:'100%', padding:'10px 0', fontSize:15 }}
            onClick={completeBooking} disabled={submitting || !cart.length}>
            {submitting ? 'Submitting…' : 'Complete Booking'}
          </button>
        </div>

        {/* Right: cart table */}
        <div>
          <table>
            <thead>
              <tr>
                <th>Item</th>
                <th>LN Code</th>
                <th style={{ textAlign:'right' }}>Qty</th>
              </tr>
            </thead>
            <tbody>
              {cart.length === 0 && (
                <tr><td colSpan={3} style={{ textAlign:'center', color:'var(--muted)', padding:20 }}>
                  No items added yet
                </td></tr>
              )}
              {cart.map((item, i) => (
                <tr key={i} onClick={() => setSelectedRow(i===selectedRow?null:i)}
                  style={{ cursor:'pointer', background: i===selectedRow ? 'var(--accent-light, #e8f0fe)' : undefined }}>
                  <td style={{ fontWeight:500 }}>{item.product_name}</td>
                  <td className="mono" style={{ fontSize:11 }}>{item.ln_code}</td>
                  <td style={{ textAlign:'right', fontFamily:'var(--font-mono)' }}>{item.quantity}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {cart.length > 0 && (
            <p style={{ fontSize:12, color:'var(--muted)', marginTop:6 }}>
              Click a row to select it, then use Delete Row to remove.
            </p>
          )}
        </div>
      </div>

      {/* ── Past Orders ── */}
      {loadingOrders ? <div className="spinner" /> : (
        <>
          <OrderSection title="Pending Booking" items={flatItems(pendingBooking, 'pending_booking')}
            columns={['Item','LN Code','Qty','Date Booked']}
            renderRow={i => [
              i.product_name, <span className="mono" style={{fontSize:11}}>{i.ln_code||'—'}</span>,
              i.ordered_qty, fmtDate(i.order_created_at),
            ]} />

          <OrderSection title="Pending Delivery" items={flatItems(pendingDelivery, 'pending_delivery')}
            columns={['Item','LN Code','Qty Ordered','Qty Delivered','Date Booked','Sales Order No.']}
            renderRow={i => [
              i.product_name, <span className="mono" style={{fontSize:11}}>{i.ln_code||'—'}</span>,
              i.ordered_qty, i.delivered_qty,
              fmtDate(i.booked_at||i.order_created_at),
              <span className="mono" style={{fontSize:11}}>{i.so_number||'—'}</span>,
            ]} />

          <OrderSection title="Delivered" items={flatItems(delivered, 'delivered')}
            columns={['Item','LN Code','Qty','Order Date','Challan No.','Bill No.','Delivered Date']}
            renderRow={i => [
              i.product_name, <span className="mono" style={{fontSize:11}}>{i.ln_code||'—'}</span>,
              i.ordered_qty,
              fmtDate(i.order_created_at),
              <span className="mono" style={{fontSize:10}}>{(i.challan_refs||[]).join(', ')||'—'}</span>,
              <span className="mono" style={{fontSize:10}}>{(i.bill_numbers||[]).join(', ')||'—'}</span>,
              fmtDate(i.delivered_at),
            ]} />
        </>
      )}
    </div>
  );
}

function OrderSection({ title, items, columns, renderRow }) {
  return (
    <div style={{ marginBottom:32 }}>
      <h3 style={{ fontSize:15, fontWeight:700, marginBottom:10, borderBottom:'2px solid var(--border)', paddingBottom:6 }}>
        {title}
        <span style={{ fontWeight:400, fontSize:13, color:'var(--muted)', marginLeft:8 }}>({items.length})</span>
      </h3>
      {items.length === 0
        ? <p style={{ color:'var(--muted)', fontSize:13 }}>No items.</p>
        : (
          <table>
            <thead><tr>{columns.map(c => <th key={c}>{c}</th>)}</tr></thead>
            <tbody>
              {items.map((item, i) => {
                const cells = renderRow(item);
                return (
                  <tr key={i}>
                    {cells.map((c, j) => <td key={j}>{c}</td>)}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
    </div>
  );
}
