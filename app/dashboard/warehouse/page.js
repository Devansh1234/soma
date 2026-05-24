'use client';
import { useState, useEffect } from 'react';

function useDebounce(v, d = 350) {
  const [dv, setDv] = useState(v);
  useEffect(() => { const t = setTimeout(() => setDv(v), d); return () => clearTimeout(t); }, [v, d]);
  return dv;
}

const EMPTY_ITEM = { product_code: '', product_name: '', packets_in_product: '', input_date: '', type_of_entry: 'Manual', location: '', price: '', invoice_number: '', invoice_date: '' };

function EditModal({ item, onSave, onClose }) {
  const [form, setForm] = useState({ ...item });
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    const res = await fetch('/api/inventory', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: item.id, ...form }),
    });
    setSaving(false);
    if (res.ok) onSave();
    else { const d = await res.json(); alert(d.error); }
  }

  const F = ({ label, field, type = 'text' }) => (
    <div className="form-group">
      <label>{label}</label>
      <input type={type} value={form[field] || ''} onChange={e => setForm(p => ({ ...p, [field]: e.target.value }))} />
    </div>
  );

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: '#fff', padding: 24, width: 560, maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
          <strong>Edit Item</strong>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18 }}>×</button>
        </div>
        <div className="form-grid">
          <F label="Product Name" field="product_name" />
          <F label="Product Code" field="product_code" />
          <F label="Location" field="location" />
          <F label="Price (₹)" field="price" type="number" />
          <F label="Invoice Number" field="invoice_number" />
          <F label="Invoice Date" field="invoice_date" />
          <F label="Input Date" field="input_date" />
          <F label="Packets in Product" field="packets_in_product" />
          <div className="form-group">
            <label>Type of Entry</label>
            <select value={form.type_of_entry || 'Manual'} onChange={e => setForm(p => ({ ...p, type_of_entry: e.target.value }))}>
              <option>Manual</option>
              <option>Invoice</option>
              <option>Transfer</option>
            </select>
          </div>
          <div className="form-group">
            <label>Status</label>
            <select value={form.status || 'free'} onChange={e => setForm(p => ({ ...p, status: e.target.value }))}>
              <option value="free">Free</option>
              <option value="committed">Committed</option>
              <option value="dispatched">Dispatched</option>
            </select>
          </div>
        </div>
        <div style={{ marginTop: 16, display: 'flex', gap: 10 }}>
          <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

function AddModal({ onSave, onClose }) {
  const [rows, setRows] = useState([{ ...EMPTY_ITEM }]);
  const [saving, setSaving] = useState(false);

  function setRow(i, field, val) {
    setRows(prev => prev.map((r, idx) => idx === i ? { ...r, [field]: val } : r));
  }
  function addRow() { setRows(p => [...p, { ...EMPTY_ITEM }]); }
  function removeRow(i) { setRows(p => p.filter((_, idx) => idx !== i)); }

  async function save() {
    const valid = rows.filter(r => r.product_name.trim());
    if (!valid.length) { alert('Product name is required'); return; }
    setSaving(true);
    const res = await fetch('/api/inventory', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(valid),
    });
    setSaving(false);
    if (res.ok) onSave();
    else { const d = await res.json(); alert(d.error); }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: '#fff', padding: 24, width: '90vw', maxWidth: 1100, maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
          <strong>Add Inventory Items</strong>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18 }}>×</button>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table>
            <thead>
              <tr>
                <th>Product Name *</th>
                <th>Product Code</th>
                <th>Pkts</th>
                <th>Location</th>
                <th>Price (₹)</th>
                <th>Invoice No.</th>
                <th>Invoice Date</th>
                <th>Input Date</th>
                <th>Entry Type</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i}>
                  {['product_name','product_code','packets_in_product','location','price','invoice_number','invoice_date','input_date'].map(f => (
                    <td key={f} style={{ padding: '3px 4px' }}>
                      <input value={row[f] || ''} onChange={e => setRow(i, f, e.target.value)} style={{ minWidth: f === 'product_name' ? 180 : 90 }} />
                    </td>
                  ))}
                  <td style={{ padding: '3px 4px' }}>
                    <select value={row.type_of_entry} onChange={e => setRow(i, 'type_of_entry', e.target.value)} style={{ width: 90 }}>
                      <option>Manual</option><option>Invoice</option><option>Transfer</option>
                    </select>
                  </td>
                  <td>
                    <button onClick={() => removeRow(i)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--danger)', fontSize: 16 }}>×</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ marginTop: 12, display: 'flex', gap: 10 }}>
          <button className="btn btn-secondary btn-sm" onClick={addRow}>+ Add Row</button>
          <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : `Save ${rows.filter(r=>r.product_name.trim()).length} Item(s)`}</button>
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

export default function WarehousePage() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [locationFilter, setLocationFilter] = useState('');
  const [locations, setLocations] = useState([]);
  const [total, setTotal] = useState(0);
  const [selected, setSelected] = useState(new Set());
  const [editItem, setEditItem] = useState(null);
  const [showAdd, setShowAdd] = useState(false);
  const [bulkStatus, setBulkStatus] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const debSearch = useDebounce(search);

  useEffect(() => { load(); }, [debSearch, statusFilter, locationFilter]);

  async function load() {
    setLoading(true);
    const params = new URLSearchParams({ limit: '500' });
    if (debSearch) params.set('q', debSearch);
    if (statusFilter) params.set('status', statusFilter);
    if (locationFilter) params.set('location', locationFilter);
    const res = await fetch(`/api/inventory?${params}`);
    const { data, count } = await res.json();
    const inv = data || [];
    setItems(inv);
    setTotal(count || 0);
    setLocations([...new Set(inv.map(i => i.location).filter(Boolean))].sort());
    setSelected(new Set());
    setLoading(false);
  }

  function toggleSelect(id) {
    setSelected(prev => {
      const s = new Set(prev);
      s.has(id) ? s.delete(id) : s.add(id);
      return s;
    });
  }

  function toggleAll() {
    if (selected.size === items.length) setSelected(new Set());
    else setSelected(new Set(items.map(i => i.id)));
  }

  async function bulkUpdate() {
    if (!selected.size || !bulkStatus) return;
    const res = await fetch('/api/inventory', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [...selected], status: bulkStatus }),
    });
    if (res.ok) { setSuccess(`Updated ${selected.size} items to "${bulkStatus}"`); load(); }
    else { const d = await res.json(); setError(d.error); }
  }

  async function deleteItem(id) {
    if (!confirm('Delete this inventory item?')) return;
    const res = await fetch(`/api/inventory?id=${id}`, { method: 'DELETE' });
    if (res.ok) load();
    else { const d = await res.json(); setError(d.error); }
  }

  const STATUS_COLORS = { free: 'badge-free', committed: 'badge-committed', dispatched: 'badge-dispatched' };

  return (
    <div className="page">
      {editItem && <EditModal item={editItem} onSave={() => { setEditItem(null); load(); }} onClose={() => setEditItem(null)} />}
      {showAdd && <AddModal onSave={() => { setShowAdd(false); load(); }} onClose={() => setShowAdd(false)} />}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <h2 className="page-title" style={{ margin: 0 }}>
          Warehouse Management
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 400, color: 'var(--muted)', marginLeft: 12 }}>{total} items</span>
        </h2>
        <button className="btn btn-primary" onClick={() => setShowAdd(true)}>+ Add Stock</button>
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {success && <div className="alert alert-success">{success}</div>}

      {/* Filters */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search product…" style={{ maxWidth: 240 }} />
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={{ maxWidth: 160 }}>
          <option value="">All statuses</option>
          <option value="free">Free</option>
          <option value="committed">Committed</option>
          <option value="dispatched">Dispatched</option>
        </select>
        <select value={locationFilter} onChange={e => setLocationFilter(e.target.value)} style={{ maxWidth: 200 }}>
          <option value="">All locations</option>
          {locations.map(l => <option key={l} value={l}>{l}</option>)}
        </select>
        <button className="btn btn-secondary btn-sm" onClick={load}>↻</button>
      </div>

      {/* Bulk actions */}
      {selected.size > 0 && (
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 10, padding: '8px 12px', background: '#f0f0ec', border: '1px solid var(--border)' }}>
          <span style={{ fontSize: 13 }}><strong>{selected.size}</strong> selected</span>
          <select value={bulkStatus} onChange={e => setBulkStatus(e.target.value)} style={{ maxWidth: 160 }}>
            <option value="">Set status…</option>
            <option value="free">Free</option>
            <option value="committed">Committed</option>
            <option value="dispatched">Dispatched</option>
          </select>
          <button className="btn btn-primary btn-sm" onClick={bulkUpdate} disabled={!bulkStatus}>Apply</button>
          <button className="btn btn-secondary btn-sm" onClick={() => setSelected(new Set())}>Clear</button>
        </div>
      )}

      {loading ? <div className="spinner" /> : (
        <div style={{ overflowX: 'auto' }}>
          <table>
            <thead>
              <tr>
                <th style={{ width: 32 }}>
                  <input type="checkbox" checked={selected.size === items.length && items.length > 0} onChange={toggleAll} style={{ width: 'auto' }} />
                </th>
                <th>Product Name</th>
                <th>Product Code</th>
                <th>Location</th>
                <th>Status</th>
                <th>Price (₹)</th>
                <th>Invoice No.</th>
                <th>Invoice Date</th>
                <th>Input Date</th>
                <th>Pkts</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 && <tr><td colSpan={11} style={{ textAlign: 'center', color: 'var(--muted)' }}>No items found</td></tr>}
              {items.map(item => (
                <tr key={item.id}>
                  <td>
                    <input type="checkbox" checked={selected.has(item.id)} onChange={() => toggleSelect(item.id)} style={{ width: 'auto' }} />
                  </td>
                  <td style={{ fontWeight: 500 }}>{item.product_name}</td>
                  <td className="mono" style={{ fontSize: 11 }}>{item.product_code || '—'}</td>
                  <td>{item.location || '—'}</td>
                  <td><span className={`badge ${STATUS_COLORS[item.status] || ''}`}>{item.status}</span></td>
                  <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 12 }}>
                    {item.price ? Number(item.price).toLocaleString('en-IN', { minimumFractionDigits: 2 }) : '—'}
                  </td>
                  <td className="mono" style={{ fontSize: 11 }}>{item.invoice_number || '—'}</td>
                  <td style={{ fontSize: 11 }}>{item.invoice_date || '—'}</td>
                  <td style={{ fontSize: 11 }}>{item.input_date || '—'}</td>
                  <td style={{ fontSize: 11 }}>{item.packets_in_product || '—'}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button className="btn btn-secondary btn-sm" style={{ marginRight: 4 }} onClick={() => setEditItem(item)}>Edit</button>
                    <button className="btn btn-danger btn-sm" onClick={() => deleteItem(item.id)}>Del</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
