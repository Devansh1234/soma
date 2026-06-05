'use client';
import { useState, useEffect, useRef } from 'react';

function useDebounce(v, d = 350) {
  const [dv, setDv] = useState(v);
  useEffect(() => { const t = setTimeout(() => setDv(v), d); return () => clearTimeout(t); }, [v, d]);
  return dv;
}

const STATUS_COLORS = { free: 'badge-free', committed: 'badge-committed', dispatched: 'badge-dispatched' };
const CHALLAN_STATUS = { awaiting_delivery: 'badge-committed', rtc: 'badge-confirmed', cancelled: 'badge-cancelled' };

// ── Shared Tab Bar ────────────────────────────────────────────────────────────
function TabBar({ tabs, active, onChange }) {
  return (
    <div style={{ display:'flex', gap:2, marginBottom:20, borderBottom:'2px solid var(--border)' }}>
      {tabs.map(([key, label, badge]) => (
        <button key={key} onClick={() => onChange(key)}
          style={{ padding:'7px 18px', fontFamily:'var(--font)', fontSize:13, fontWeight: active===key?700:400,
            background:'none', border:'none', cursor:'pointer',
            borderBottom: active===key ? '2px solid var(--accent)' : '2px solid transparent',
            color: active===key ? 'var(--accent)' : 'var(--muted)', marginBottom:-2 }}>
          {label}
          {badge ? <span style={{ marginLeft:6, background:'var(--warn)', color:'#fff', borderRadius:10, padding:'1px 6px', fontSize:11 }}>{badge}</span> : null}
        </button>
      ))}
    </div>
  );
}

// ── RECEIVE STOCK TAB ─────────────────────────────────────────────────────────
function ReceiveStockTab({ company }) {
  const [stage, setStage]       = useState('upload');   // upload | review | done
  const [parsing, setParsing]   = useState(false);
  const [parsed, setParsed]     = useState(null);       // { invoiceNumber, invoiceDate, items }
  const [confirming, setConfirming] = useState(false);
  const [error, setError]       = useState('');
  const [success, setSuccess]   = useState('');
  const [pendingItems, setPendingItems] = useState([]);
  const [pendingLoading, setPendingLoading] = useState(false);
  const fileRef = useRef();

  const [notReceivedItems, setNRI] = useState([]);

  async function loadNotReceived() {
    const res = await fetch('/api/inventory?pending=true&not_received=true&company=all&limit=200');
    const { data } = await res.json();
    setNRI(data || []);
  }

  async function confirmNotReceived(ids) {
    const res = await fetch('/api/inventory/confirm-invoice', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids }),
    });
    if (res.ok) {
      // Also clear not_received flag
      await Promise.all(ids.map(id =>
        fetch('/api/inventory', {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id, not_received: false }),
        })
      ));
      setSuccess(`✓ ${ids.length} item(s) confirmed as received.`);
      loadPending(); loadNotReceived();
    } else { const d = await res.json(); setError(d.error); }
  }

  useEffect(() => { loadPending(); loadNotReceived(); }, []);

  async function loadPending() {
    setPendingLoading(true);
    const res = await fetch('/api/inventory?pending=true&not_received=false&company=all&limit=200');
    const { data } = await res.json();
    setPendingItems(data || []);
    setPendingLoading(false);
  }

  async function markNotReceived(id, productName) {
    const res = await fetch('/api/inventory', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, not_received: true }),
    });
    if (res.ok) { setSuccess(`"${productName}" moved to Expected — Not Yet Received.`); loadPending(); loadNotReceived(); }
    else { const d = await res.json(); setError(d.error); }
  }

  async function handleFile(file) {
    if (!file || !file.name.endsWith('.pdf')) { setError('Please select a PDF file.'); return; }
    setError(''); setParsing(true);
    try {
      const base64 = await new Promise((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(r.result.split(',')[1]);
        r.onerror = rej;
        r.readAsDataURL(file);
      });
      const resp = await fetch('/api/inventory/parse-invoice', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pdfBase64: base64 }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        // Show debug lines so we can diagnose the text extraction layout
        let msg = data.error || 'Parse failed';
        if (data.debugLines) {
          msg += '\n\nExtracted text (first 30 lines):\n' + data.debugLines.slice(0,30).join('\n');
        }
        setError(msg);
        return;
      }
      setParsed(data);
      setStage('review');
    } catch (e) { setError(e.message); }
    finally { setParsing(false); }
  }

  function toggleReceived(i) {
    setParsed(p => ({ ...p, items: p.items.map((item, idx) => idx===i ? { ...item, received: !item.received } : item) }));
  }

  function setAllReceived(val) {
    setParsed(p => ({ ...p, items: p.items.map(item => ({ ...item, received: val })) }));
  }

  async function confirmReceipt() {
    setConfirming(true); setError('');
    const res = await fetch('/api/inventory/confirm-invoice', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ invoiceNumber: parsed.invoiceNumber, invoiceDate: parsed.invoiceDate, items: parsed.items }),
    });
    const data = await res.json();
    setConfirming(false);
    if (res.ok) {
      setSuccess(`✓ ${data.rowsCreated} inventory items added.${data.pendingCount ? ` ${data.pendingCount} pending confirmation.` : ''}`);
      setStage('done');
      loadPending();
    } else { setError(data.error); }
  }

  async function confirmPendingItems(ids) {
    const res = await fetch('/api/inventory/confirm-invoice', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids }),
    });
    if (res.ok) { setSuccess(`✓ ${ids.length} items confirmed as received.`); loadPending(); }
    else { const d = await res.json(); setError(d.error); }
  }

  return (
    <div>
      {error   && <div className="alert alert-error">{error}</div>}
      {success && <div className="alert alert-success">{success}</div>}

      {/* Pending receipts */}
      {pendingItems.length > 0 && (
        <div className="card" style={{ marginBottom: 20 }}>
          <div className="card-title" style={{ color:'var(--warn)' }}>
            ⚠ Pending Receipts — {pendingItems.length} items awaiting physical confirmation
          </div>
          <p style={{ fontSize:12, color:'var(--muted)', marginBottom:12 }}>
            These items were on an invoice but not confirmed as physically received. Check them off once you have them in hand.
          </p>
          <table>
            <thead><tr><th>Product Name</th><th>LN Code</th><th>Invoice No.</th><th>Invoice Date</th><th>Price (₹)</th><th>Action</th></tr></thead>
            <tbody>
              {pendingItems.map((item, i) => (
                <tr key={i}>
                  <td>{item.product_name}</td>
                  <td className="mono" style={{ fontSize:11 }}>{item.product_code || '—'}</td>
                  <td className="mono" style={{ fontSize:11 }}>{item.invoice_number || '—'}</td>
                  <td style={{ fontSize:11 }}>{item.invoice_date || '—'}</td>
                  <td style={{ textAlign:'right', fontFamily:'var(--font-mono)', fontSize:12 }}>
                    {item.price ? Number(item.price).toLocaleString('en-IN', { minimumFractionDigits:2 }) : '—'}
                  </td>
                  <td style={{ whiteSpace:'nowrap', display:'flex', gap:6 }}>
                    <button className="btn btn-primary btn-sm" onClick={() => confirmPendingItems([item.id])}>
                      ✓ Received
                    </button>
                    <button className="btn btn-danger btn-sm" onClick={() => markNotReceived(item.id, item.product_name)}>
                      ✗ Not Received
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {pendingItems.length > 1 && (
            <button className="btn btn-primary btn-sm" style={{ marginTop:10 }}
              onClick={() => confirmPendingItems(pendingItems.map(i => i.id))}>
              ✓ Mark All as Received
            </button>
          )}
        </div>
      )}

      {/* Expected — Not Yet Received */}
      {notReceivedItems.length > 0 && (
        <div className="card" style={{ marginTop:20 }}>
          <div className="card-title" style={{ color:'var(--muted)' }}>
            📦 Expected — Not Yet Received ({notReceivedItems.length} items)
          </div>
          <p style={{ fontSize:12, color:'var(--muted)', marginBottom:12 }}>
            These items were on an invoice but not physically received at that time. Mark them as received when they arrive.
          </p>
          <table>
            <thead><tr><th>Product Name</th><th>LN Code</th><th>Invoice No.</th><th>Invoice Date</th><th>Price (₹)</th><th>Action</th></tr></thead>
            <tbody>
              {notReceivedItems.map((item, i) => (
                <tr key={i}>
                  <td>{item.product_name}</td>
                  <td className="mono" style={{ fontSize:11 }}>{item.product_code || '—'}</td>
                  <td className="mono" style={{ fontSize:11 }}>{item.invoice_number || '—'}</td>
                  <td style={{ fontSize:11 }}>{item.invoice_date || '—'}</td>
                  <td style={{ textAlign:'right', fontFamily:'var(--font-mono)', fontSize:12 }}>
                    {item.price ? Number(item.price).toLocaleString('en-IN', { minimumFractionDigits:2 }) : '—'}
                  </td>
                  <td>
                    <button className="btn btn-primary btn-sm" onClick={() => confirmNotReceived([item.id])}>
                      ✓ Now Received
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {notReceivedItems.length > 1 && (
            <button className="btn btn-primary btn-sm" style={{ marginTop:10 }}
              onClick={() => confirmNotReceived(notReceivedItems.map(i => i.id))}>
              ✓ Mark All as Now Received
            </button>
          )}
        </div>
      )}

      {/* Upload stage */}
      {stage === 'upload' && (
        <div className="card">
          <div className="card-title">Upload Godrej Invoice PDF</div>
          <div
            onDragOver={e => e.preventDefault()}
            onDrop={e => { e.preventDefault(); handleFile(e.dataTransfer.files[0]); }}
            onClick={() => fileRef.current?.click()}
            style={{ border:'2px dashed var(--border)', padding:40, textAlign:'center', cursor:'pointer', borderRadius:2, background:'#fafafa' }}>
            <div style={{ fontSize:32, marginBottom:8 }}>📄</div>
            <div style={{ fontSize:14, fontWeight:600 }}>Drop Godrej Invoice PDF here or click to browse</div>
            <div style={{ fontSize:12, color:'var(--muted)', marginTop:4 }}>Accepts Godrej & Boyce Tax Invoice PDFs only</div>
          </div>
          <input ref={fileRef} type="file" accept=".pdf" style={{ display:'none' }} onChange={e => handleFile(e.target.files[0])} />
          {parsing && <div style={{ marginTop:12, display:'flex', alignItems:'center', gap:8 }}><div className="spinner" /><span>Parsing PDF…</span></div>}
        </div>
      )}

      {/* Review stage */}
      {stage === 'review' && parsed && (
        <div>
          <div className="card">
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12 }}>
              <div>
                <strong style={{ fontSize:15 }}>Invoice: {parsed.invoiceNumber}</strong>
                <span style={{ fontSize:12, color:'var(--muted)', marginLeft:12 }}>Date: {parsed.invoiceDate}</span>
                <span style={{ fontSize:12, color:'var(--muted)', marginLeft:12 }}>{parsed.items.length} line items · {parsed.items.reduce((s,i)=>s+i.quantity,0)} units total</span>
              </div>
              <button className="btn btn-secondary btn-sm" onClick={() => setStage('upload')}>← Back</button>
            </div>
            <div className="alert alert-info" style={{ marginBottom:12 }}>
              Tick each item that has <strong>actually been received</strong>. Unticked items will be saved as <strong>pending</strong> — you can confirm them later when they arrive.
            </div>
            <div style={{ display:'flex', gap:10, marginBottom:10 }}>
              <button className="btn btn-secondary btn-sm" onClick={() => setAllReceived(true)}>✓ All Received</button>
              <button className="btn btn-secondary btn-sm" onClick={() => setAllReceived(false)}>✗ None Received</button>
            </div>
            <table>
              <thead>
                <tr>
                  <th style={{ width:40 }}>Recd.</th>
                  <th>LN Code</th>
                  <th>Description</th>
                  <th>Qty</th>
                  <th>Pkgs</th>
                  <th>Unit Price (₹)</th>
                </tr>
              </thead>
              <tbody>
                {parsed.items.map((item, i) => (
                  <tr key={i} style={{ background: item.received ? undefined : '#fff8e1' }}>
                    <td style={{ textAlign:'center' }}>
                      <input type="checkbox" checked={item.received} style={{ width:'auto' }}
                        onChange={() => toggleReceived(i)} />
                    </td>
                    <td className="mono" style={{ fontSize:11 }}>{item.ln_code}</td>
                    <td>{item.product_name}</td>
                    <td style={{ textAlign:'center', fontFamily:'var(--font-mono)' }}>{item.quantity}</td>
                    <td style={{ textAlign:'center' }}>{item.packets_in_product}</td>
                    <td style={{ textAlign:'right', fontFamily:'var(--font-mono)' }}>
                      {item.price ? Number(item.price).toLocaleString('en-IN', { minimumFractionDigits:2 }) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ marginTop:16, display:'flex', gap:12, alignItems:'center' }}>
              <button className="btn btn-primary" onClick={confirmReceipt} disabled={confirming}>
                {confirming ? <><span className="spinner" style={{ marginRight:6 }} />Saving…</> : `✓ Confirm Receipt (${parsed.items.filter(i=>i.received).reduce((s,i)=>s+i.quantity,0)} units)`}
              </button>
              <span style={{ fontSize:12, color:'var(--muted)' }}>
                {parsed.items.filter(i=>!i.received).reduce((s,i)=>s+i.quantity,0)} units will be marked as pending
              </span>
            </div>
          </div>
        </div>
      )}

      {stage === 'done' && (
        <div className="card">
          <div style={{ fontSize:15, fontWeight:700, color:'var(--success)', marginBottom:12 }}>✓ Invoice processed successfully</div>
          <button className="btn btn-primary" onClick={() => { setStage('upload'); setParsed(null); setError(''); setSuccess(''); }}>
            Upload Another Invoice
          </button>
        </div>
      )}
    </div>
  );
}

// ── DISPATCH TAB (Pending RTC Challans) ───────────────────────────────────────
function DispatchTab() {
  const [challans, setChallans]   = useState([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState('');
  const [success, setSuccess]     = useState('');

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    const [custRes, intRes] = await Promise.all([
      fetch('/api/challan?status=awaiting_delivery&company=all&limit=200'),
      fetch('/api/internal-challan?status=awaiting_delivery&limit=200'),
    ]);
    const { data: custData } = await custRes.json();
    const { data: intData  } = await intRes.json();
    setChallans([
      ...(custData || []).map(c => ({...c, _type:'customer'})),
      ...(intData  || []).map(c => ({...c, _type:'internal'})),
    ]);
    setLoading(false);
  }

  async function markRTC(challanNumber) {
    if (!confirm(`Release challan ${challanNumber} to customer?`)) return;
    const res = await fetch('/api/challan/lifecycle', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ challanNumber, action:'rtc' }),
    });
    if (res.ok) { setSuccess(`${challanNumber} released. Email sent.`); load(); }
    else { const d = await res.json(); setError(d.error); }
  }

  async function releaseInternal(challanNumber) {
    if (!confirm(`Release internal transfer ${challanNumber}? Inventory locations will be updated.`)) return;
    const res = await fetch('/api/internal-challan/release', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ challanNumber }),
    });
    const d = await res.json();
    if (res.ok) {
      const warn = d.warnings?.length ? ` ⚠ ${d.warnings.length} shortfall(s).` : '';
      setSuccess(`${challanNumber} released. Locations updated.${warn}`);
      load();
    } else { setError(d.error); }
  }

  return (
    <div>
      {error   && <div className="alert alert-error">{error}</div>}
      {success && <div className="alert alert-success">{success}</div>}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:14 }}>
        <h3 style={{ margin:0, fontSize:14 }}>Pending Dispatch ({challans.length})</h3>
        <button className="btn btn-secondary btn-sm" onClick={load}>↻ Refresh</button>
      </div>
      {loading ? <div className="spinner" /> : (
        challans.length === 0
          ? <p style={{ color:'var(--success)' }}>✓ No challans awaiting delivery.</p>
          : (
            <table>
              <thead>
                <tr><th>Challan No.</th><th>Customer</th><th>Date</th><th>CCID</th><th>Products</th><th>Action</th></tr>
              </thead>
              <tbody>
                {challans.map((c, i) => {
                  const stale = (() => {
                    const raw = c['Generated DateTime'] || '';
                    const parts = raw.split(' ')[0]?.split('-');
                    if (!parts || parts.length < 3) return false;
                    const d = new Date(parts[2], parts[1]-1, parts[0]);
                    return (Date.now() - d.getTime()) >= 3*24*60*60*1000;
                  })();
                  return (
                    <tr key={i} style={{ background: stale ? '#fff8e1' : undefined }}>
                      <td className="mono" style={{ fontSize:11 }}>
                        {stale && <span style={{ marginRight:4 }}>⚠️</span>}
                        {c['Challan Number']}
                      </td>
                      <td>{c['Customer Name']}</td>
                      <td style={{ fontSize:11, color:'var(--muted)' }}>{c['Order Dated']}</td>
                      <td className="mono" style={{ fontSize:10, color:'var(--muted)' }}>{c.ccid || '—'}</td>
                      <td style={{ fontSize:11, maxWidth:240, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{c['Products']}</td>
                      <td>
                        {c._type === 'internal' ? (
                          <button className="btn btn-secondary btn-sm" onClick={() => releaseInternal(c['Challan Number'])}>
                            📦 Release Transfer
                          </button>
                        ) : (
                          <button className="btn btn-primary btn-sm" onClick={() => markRTC(c['Challan Number'])}>
                            ✓ Mark RTC
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )
      )}
    </div>
  );
}

// ── EDIT MODAL ────────────────────────────────────────────────────────────────
function EditModal({ item, onSave, onClose }) {
  const [form, setForm]     = useState({ ...item });
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    const res = await fetch('/api/inventory', {
      method:'PATCH', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ id: item.id, ...form }),
    });
    setSaving(false);
    if (res.ok) onSave(); else { const d = await res.json(); alert(d.error); }
  }

  const F = ({ label, field, type='text' }) => (
    <div className="form-group">
      <label>{label}</label>
      <input type={type} value={form[field]||''} onChange={e => setForm(p=>({...p,[field]:e.target.value}))} />
    </div>
  );

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.5)', zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center' }}>
      <div style={{ background:'#fff', padding:24, width:560, maxHeight:'90vh', overflowY:'auto' }}>
        <div style={{ display:'flex', justifyContent:'space-between', marginBottom:16 }}>
          <strong>Edit Item</strong>
          <button onClick={onClose} style={{ background:'none', border:'none', cursor:'pointer', fontSize:18 }}>×</button>
        </div>
        <div className="form-grid">
          <F label="Product Name"  field="product_name" />
          <F label="LN Code"       field="product_code" />
          <F label="Location"      field="location" />
          <F label="Price (₹)"    field="price" type="number" />
          <F label="Invoice No."   field="invoice_number" />
          <F label="Invoice Date"  field="invoice_date" />
          <F label="Input Date"    field="input_date" />
          <F label="Packets"       field="packets_in_product" />
          <div className="form-group">
            <label>Status</label>
            <select value={form.status||'free'} onChange={e => setForm(p=>({...p,status:e.target.value}))}>
              <option value="free">Free</option>
              <option value="committed">Committed</option>
              <option value="dispatched">Dispatched</option>
            </select>
          </div>
        </div>
        <div style={{ marginTop:16, display:'flex', gap:10 }}>
          <button className="btn btn-primary" onClick={save} disabled={saving}>{saving?'Saving…':'Save'}</button>
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

// ── ADJUSTMENTS TAB ───────────────────────────────────────────────────────────
function AdjustmentsTab() {
  const [addRows, setAddRows] = useState([{ product_name:'', product_code:'', price:'', quantity:1, location:'', invoice_number:'' }]);
  const [saving, setSaving]   = useState(false);
  const [error, setError]     = useState('');
  const [success, setSuccess] = useState('');

  function setRow(i, field, val) {
    setAddRows(prev => prev.map((r,idx) => idx===i ? {...r,[field]:val} : r));
  }

  async function saveAdd() {
    const valid = addRows.filter(r => r.product_name.trim());
    if (!valid.length) { setError('Product name is required.'); return; }
    setSaving(true); setError('');
    const res = await fetch('/api/inventory', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify(valid),
    });
    setSaving(false);
    if (res.ok) {
      const total = valid.reduce((s,r)=>s+(parseInt(r.quantity)||1),0);
      setSuccess(`✓ ${total} item(s) added to inventory. Email sent.`);
      setAddRows([{ product_name:'', product_code:'', price:'', quantity:1, location:'', invoice_number:'' }]);
    } else { const d = await res.json(); setError(d.error); }
  }

  return (
    <div>
      {error   && <div className="alert alert-error">{error}</div>}
      {success && <div className="alert alert-success">{success}</div>}

      <div className="card">
        <div className="card-title" style={{ display:'flex', justifyContent:'space-between' }}>
          Manual Stock Addition
          <button className="btn btn-secondary btn-sm" onClick={() => setAddRows(p=>[...p,{product_name:'',product_code:'',price:'',quantity:1,location:'',invoice_number:''}])}>
            + Add Row
          </button>
        </div>
        <p style={{ fontSize:12, color:'var(--muted)', marginBottom:12 }}>
          Use this for items received without a Godrej invoice (e.g. replacement deliveries, transfers). An email notification will be sent.
        </p>
        <div style={{ overflowX:'auto' }}>
          <table>
            <thead>
              <tr>
                <th>Product Name *</th>
                <th>LN Code</th>
                <th>Qty</th>
                <th>Price (₹)</th>
                <th>Location</th>
                <th>Invoice No. (opt.)</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {addRows.map((row, i) => (
                <tr key={i}>
                  {['product_name','product_code','quantity','price','location','invoice_number'].map(f => (
                    <td key={f} style={{ padding:'3px 4px' }}>
                      <input value={row[f]||''} type={f==='quantity'||f==='price'?'number':'text'}
                        min={f==='quantity'?1:undefined} step={f==='price'?'0.01':undefined}
                        onChange={e => setRow(i,f,e.target.value)} style={{ minWidth: f==='product_name'?180:80 }} />
                    </td>
                  ))}
                  <td><button onClick={() => setAddRows(p=>p.filter((_,idx)=>idx!==i))} style={{ background:'none', border:'none', cursor:'pointer', color:'var(--danger)', fontSize:16 }}>×</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button className="btn btn-primary" style={{ marginTop:14 }} onClick={saveAdd} disabled={saving}>
          {saving ? 'Saving…' : `Add ${addRows.filter(r=>r.product_name.trim()).reduce((s,r)=>s+(parseInt(r.quantity)||1),0)} Item(s) to Inventory`}
        </button>
      </div>
    </div>
  );
}

// ── INVENTORY TAB ─────────────────────────────────────────────────────────────
function InventoryTab() {
  const [items, setItems]           = useState([]);
  const [total, setTotal]           = useState(0);
  const [loading, setLoading]       = useState(true);
  const [search, setSearch]         = useState('');
  const [statusFilter, setStatus]   = useState('');
  const [locations, setLocations]   = useState([]);
  const [locFilter, setLocFilter]   = useState('');
  const [selected, setSelected]     = useState(new Set());
  const [editItem, setEditItem]     = useState(null);
  const [bulkStatus, setBulkStatus] = useState('');
  const [error, setError]           = useState('');
  const [success, setSuccess]       = useState('');
  const debSearch = useDebounce(search);

  useEffect(() => { load(); }, [debSearch, statusFilter, locFilter]);

  async function load() {
    setLoading(true);
    const params = new URLSearchParams({ limit:'500', pending:'false' });
    if (debSearch)   params.set('q', debSearch);
    if (statusFilter) params.set('status', statusFilter);
    if (locFilter)   params.set('location', locFilter);
    const res = await fetch(`/api/inventory?${params}`);
    const { data, count } = await res.json();
    const inv = data || [];
    setItems(inv); setTotal(count||0);
    setLocations([...new Set(inv.map(i=>i.location).filter(Boolean))].sort());
    setSelected(new Set());
    setLoading(false);
  }

  function toggleSelect(id) {
    setSelected(prev => { const s=new Set(prev); s.has(id)?s.delete(id):s.add(id); return s; });
  }

  async function bulkUpdate() {
    if (!selected.size || !bulkStatus) return;
    const res = await fetch('/api/inventory', {
      method:'PATCH', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ ids:[...selected], status:bulkStatus }),
    });
    if (res.ok) { setSuccess(`Updated ${selected.size} items.`); load(); }
    else { const d=await res.json(); setError(d.error); }
  }

  async function deleteItem(id) {
    const reason = prompt('Reason for removal:');
    if (reason === null) return;
    const res = await fetch(`/api/inventory?id=${id}&reason=${encodeURIComponent(reason||'Manual removal')}`, { method:'DELETE' });
    if (res.ok) { setSuccess('Item removed. Email sent.'); load(); }
    else { const d=await res.json(); setError(d.error); }
  }

  return (
    <div>
      {editItem && <EditModal item={editItem} onSave={()=>{setEditItem(null);load();}} onClose={()=>setEditItem(null)} />}

      {error   && <div className="alert alert-error">{error}</div>}
      {success && <div className="alert alert-success">{success}</div>}

      <div style={{ display:'flex', gap:10, marginBottom:12, flexWrap:'wrap' }}>
        <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search product…" style={{ maxWidth:240 }} />
        <select value={statusFilter} onChange={e=>setStatus(e.target.value)} style={{ maxWidth:160 }}>
          <option value="">All statuses</option>
          <option value="free">Free</option>
          <option value="committed">Committed</option>
          <option value="dispatched">Dispatched</option>
        </select>
        <select value={locFilter} onChange={e=>setLocFilter(e.target.value)} style={{ maxWidth:180 }}>
          <option value="">All locations</option>
          {locations.map(l=><option key={l} value={l}>{l}</option>)}
        </select>
        <button className="btn btn-secondary btn-sm" onClick={load}>↻</button>
        <span style={{ fontFamily:'var(--font-mono)', fontSize:12, color:'var(--muted)', alignSelf:'center', marginLeft:'auto' }}>{total} items</span>
      </div>

      {selected.size > 0 && (
        <div style={{ display:'flex', gap:10, alignItems:'center', marginBottom:10, padding:'8px 12px', background:'#f0f0ec', border:'1px solid var(--border)' }}>
          <span style={{ fontSize:13 }}><strong>{selected.size}</strong> selected</span>
          <select value={bulkStatus} onChange={e=>setBulkStatus(e.target.value)} style={{ maxWidth:160 }}>
            <option value="">Set status…</option>
            <option value="free">Free</option>
            <option value="committed">Committed</option>
            <option value="dispatched">Dispatched</option>
          </select>
          <button className="btn btn-primary btn-sm" onClick={bulkUpdate} disabled={!bulkStatus}>Apply</button>
          <button className="btn btn-secondary btn-sm" onClick={()=>setSelected(new Set())}>Clear</button>
        </div>
      )}

      {loading ? <div className="spinner" /> : (
        <div style={{ overflowX:'auto' }}>
          <table>
            <thead>
              <tr>
                <th><input type="checkbox" checked={selected.size===items.length&&items.length>0}
                  onChange={()=>setSelected(s=>s.size===items.length?new Set():new Set(items.map(i=>i.id)))}
                  style={{ width:'auto' }} /></th>
                <th>Product Name</th><th>LN Code</th><th>Status</th>
                <th>Price (₹)</th><th>Location</th><th>Invoice No.</th><th>Input Date</th><th>Pkts</th><th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.length===0 && <tr><td colSpan={10} style={{ textAlign:'center', color:'var(--muted)' }}>No items found</td></tr>}
              {items.map(item => (
                <tr key={item.id}>
                  <td><input type="checkbox" checked={selected.has(item.id)} style={{ width:'auto' }} onChange={()=>toggleSelect(item.id)} /></td>
                  <td style={{ fontWeight:500 }}>{item.product_name}</td>
                  <td className="mono" style={{ fontSize:11 }}>{item.product_code||'—'}</td>
                  <td><span className={`badge ${STATUS_COLORS[item.status]||''}`}>{item.status}</span></td>
                  <td style={{ textAlign:'right', fontFamily:'var(--font-mono)', fontSize:12 }}>
                    {item.price ? Number(item.price).toLocaleString('en-IN',{minimumFractionDigits:2}) : '—'}
                  </td>
                  <td>{item.location||'—'}</td>
                  <td className="mono" style={{ fontSize:11 }}>{item.invoice_number||'—'}</td>
                  <td style={{ fontSize:11 }}>{item.input_date||'—'}</td>
                  <td style={{ fontSize:11 }}>{item.packets_in_product||'—'}</td>
                  <td style={{ whiteSpace:'nowrap' }}>
                    <button className="btn btn-secondary btn-sm" style={{ marginRight:4 }} onClick={()=>setEditItem(item)}>Edit</button>
                    <button className="btn btn-danger btn-sm" onClick={()=>deleteItem(item.id)}>Del</button>
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

// ── INTERNAL TRANSFER TAB ────────────────────────────────────────────────────
const WAREHOUSES   = ['Bhelupur Warehouse','Lehertara Warehouse','Rohaniya Warehouse'];
const DESTINATIONS = ['Soma Showroom','Sunderpur Showroom','Bhelupur Warehouse','Lehertara Warehouse','Rohaniya Warehouse'];

function InternalTransferTab() {
  const emptyRow = () => ({ name:'', ln_code:'', price:'', quantity:1 });
  const [sourceWH,     setSourceWH]     = useState(WAREHOUSES[0]);
  const [destLoc,      setDestLoc]      = useState(DESTINATIONS[0]);
  const [requestedBy,  setRequestedBy]  = useState('');
  const [isDisplay,    setIsDisplay]    = useState(false);
  const [products,     setProducts]     = useState([emptyRow()]);
  const [preview,      setPreview]      = useState('');
  const [submitting,   setSubmitting]   = useState(false);
  const [generated,    setGenerated]    = useState(null);
  const [error,        setError]        = useState('');
  const [history,      setHistory]      = useState([]);

  useEffect(() => { loadPreview(); loadHistory(); }, [sourceWH]);

  async function loadPreview() {
    const res = await fetch(`/api/internal-challan/preview?warehouse=${encodeURIComponent(sourceWH)}`);
    const d   = await res.json();
    setPreview(d.preview || '');
  }

  async function loadHistory() {
    const res = await fetch('/api/internal-challan?limit=30');
    const d   = await res.json();
    setHistory(d.data || []);
  }

  function setField(i, field, val) {
    setProducts(prev => prev.map((p,idx) => idx===i ? {...p,[field]:val} : p));
  }

  async function onProductSelect(i, nameVal) {
    setField(i, 'name', nameVal);
    try {
      const list = await fetch(`/api/products?q=${encodeURIComponent(nameVal)}&limit=1`).then(r=>r.json());
      const match = Array.isArray(list) && list.find(p=>p.name?.toLowerCase()===nameVal.toLowerCase());
      if (match?.ln_code) setProducts(prev=>prev.map((p,idx)=>idx!==i?p:{...p,name:match.name,ln_code:match.ln_code,price:p.price||(match.base_price?String(match.base_price):p.price)}));
    } catch {}
  }

  async function onLNChange(i, val) {
    setField(i,'ln_code',val.toUpperCase());
    if (val.length===15) {
      try {
        const prod = await fetch(`/api/products?ln=${encodeURIComponent(val.toUpperCase())}`).then(r=>r.json());
        if (prod?.name) setProducts(prev=>prev.map((p,idx)=>idx!==i?p:{...p,ln_code:prod.ln_code,name:p.name||prod.name,price:p.price||(prod.base_price?String(prod.base_price):p.price)}));
      } catch {}
    }
  }

  async function handleGenerate() {
    const valid = products.filter(p=>p.name.trim());
    if (!valid.length) { setError('Add at least one product.'); return; }
    setSubmitting(true); setError('');
    const res = await fetch('/api/internal-challan', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ sourceWarehouse:sourceWH, destinationLocation:destLoc,
        requestedBy, isDisplay, products:valid }),
    });
    const data = await res.json();
    setSubmitting(false);
    if (res.ok) {
      setGenerated(data);
      generateInternalPDF(data);
      loadPreview(); loadHistory();
      setProducts([emptyRow()]); setRequestedBy(''); setIsDisplay(false);
    } else { setError(data.error); }
  }

  async function generateInternalPDF(challan, download=true) {
    const { default: jsPDF } = await import('jspdf');
    const doc = new jsPDF({ unit:'pt', format:'a4' });
    const W = 595.28, margin = 35;
    const bw = W - 2*margin;

    // Logo (reuse from challan page — fallback to text if not available)
    try {
      const logoRes = await fetch('/logo-base64');
      // Logo loading handled separately; fall back to text
    } catch {}

    doc.setFontSize(9).setFont('helvetica','normal').setTextColor(100);
    doc.text('Godrej Interio', W/2, 85, { align:'center' });

    // Outer box
    doc.setDrawColor(0).setLineWidth(0.75);
    doc.rect(margin, 120, bw, 680);

    // Title
    doc.setFontSize(14).setFont('helvetica','bold').setTextColor(0);
    doc.text('INTERNAL TRANSFER CHALLAN', W/2, 148, { align:'center' });

    // Divider
    doc.setLineWidth(0.5).line(margin, 158, margin+bw, 158);

    // From / challan info block
    const leftX = margin+10, rightX = margin+bw/2+10;
    let y = 175;
    doc.setFontSize(10).setFont('helvetica','bold');
    doc.text(challan.sourceWarehouse || '', leftX, y);
    doc.setFont('helvetica','normal').setFontSize(9);

    doc.setFont('helvetica','normal').setFontSize(9);
    doc.text(`Challan No: ${challan.challanNumber}`, rightX, y);
    doc.text(`Date: ${challan.challanDate}`, rightX, y+13);

    y += 30;
    doc.setLineWidth(0.4).line(margin, y, margin+bw, y);

    // To / details block
    y += 15;
    doc.setFont('helvetica','bold').setFontSize(10);
    doc.text(`To: ${challan.destinationLocation}`, leftX, y);
    y += 14;
    doc.setFont('helvetica','normal').setFontSize(9);
    if (challan.requestedBy) doc.text(`Requested by: ${challan.requestedBy}`, leftX, y);
    doc.text(`Display Item: ${challan.isDisplay ? 'Yes' : 'No'}`, rightX, y);

    y += 20;
    doc.setLineWidth(0.4).line(margin, y, margin+bw, y);

    // Products table header
    y += 15;
    const colW = [30, bw-30-160-80, 160, 80];
    const colX = [margin+5, margin+35, margin+35+colW[1], margin+35+colW[1]+160];
    doc.setFont('helvetica','bold').setFontSize(9);
    ['Sr.','Description','LN Code','Qty'].forEach((h,i) => doc.text(h, colX[i], y));
    y += 3;
    doc.setLineWidth(0.4).line(margin, y, margin+bw, y);
    y += 12;

    doc.setFont('helvetica','normal').setFontSize(9);
    (challan.products||[]).forEach((p,i) => {
      doc.text(String(i+1)+'.', colX[0], y);
      const descLines = doc.splitTextToSize('Godrej '+p.name, colW[1]-10);
      doc.text(descLines, colX[1], y);
      doc.text(p.ln_code||'—', colX[2], y);
      doc.text(String(p.quantity), colX[3], y);
      y += Math.max(descLines.length*11, 13);
    });

    // Footer line
    const footerY = 120+680-90;
    doc.setLineWidth(0.4).line(margin, footerY, margin+bw, footerY);
    doc.setFontSize(8).setTextColor(100);
    doc.text('All the listed items have been received in order and good condition.', W/2, footerY+12, { align:'center' });

    // Signature boxes
    const sigW = bw/3;
    const sigY = footerY+20;
    ['Received in Good Condition','For Internal Use','Goods Transporter'].forEach((label,i) => {
      const sx = margin + i*sigW;
      doc.setDrawColor(180).rect(sx, sigY, sigW, 70);
      doc.setTextColor(100).setFontSize(7);
      doc.text(label, sx+sigW/2, sigY+62, { align:'center' });
    });

    if (download) doc.save(`${challan.challanNumber.replace(/\//g,'-')}.pdf`);
    return doc.output('datauristring').split(',')[1];
  }

  const pending = history.filter(c=>c.status==='awaiting_delivery');
  const released = history.filter(c=>c.status==='rtc');

  return (
    <div>
      {error && <div className="alert alert-error">{error}</div>}
      {generated && <div className="alert alert-success">✓ {generated.challanNumber} created. PDF downloaded.</div>}

      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:20 }}>
        {/* Form */}
        <div className="card">
          <div className="card-title" style={{ display:'flex', justifyContent:'space-between' }}>
            New Internal Transfer
            {preview && <span style={{ fontFamily:'var(--font-mono)', fontSize:12, color:'var(--muted)' }}>Next: {preview}</span>}
          </div>

          <div className="form-group">
            <label>From (Source Warehouse)</label>
            <select value={sourceWH} onChange={e=>{setSourceWH(e.target.value);}}>
              {WAREHOUSES.map(w=><option key={w} value={w}>{w}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label>To (Destination)</label>
            <select value={destLoc} onChange={e=>setDestLoc(e.target.value)}>
              {DESTINATIONS.map(d=><option key={d} value={d}>{d}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label>Requested By</label>
            <input value={requestedBy} onChange={e=>setRequestedBy(e.target.value)} placeholder="Name of person requesting" />
          </div>
          <div className="form-group" style={{ flexDirection:'row', alignItems:'center', gap:8 }}>
            <input type="checkbox" checked={isDisplay} onChange={e=>setIsDisplay(e.target.checked)} style={{ width:'auto' }} id="isDisplayChk" />
            <label htmlFor="isDisplayChk" style={{ margin:0 }}>For Showroom Display (item stays in free stock)</label>
          </div>

          {/* Product rows */}
          <div style={{ marginTop:12 }}>
            <div style={{ display:'grid', gridTemplateColumns:'2fr 140px 80px 40px', gap:4, fontSize:11, color:'var(--muted)', marginBottom:4 }}>
              <span>Product Name</span><span>LN Code</span><span>Qty</span><span></span>
            </div>
            {products.map((p,i)=>(
              <div key={i} style={{ display:'grid', gridTemplateColumns:'2fr 140px 80px 40px', gap:4, marginBottom:4 }}>
                <input value={p.name} onChange={e=>setField(i,'name',e.target.value)}
                  onBlur={e=>onProductSelect(i,e.target.value)} placeholder="Product name…" />
                <input value={p.ln_code||''} onChange={e=>onLNChange(i,e.target.value)}
                  placeholder="LN Code" maxLength={15}
                  style={{ fontFamily:'var(--font-mono)', fontSize:11 }} />
                <input type="number" min={1} value={p.quantity} onChange={e=>setField(i,'quantity',parseInt(e.target.value)||1)} />
                <button onClick={()=>setProducts(prev=>prev.filter((_,idx)=>idx!==i))}
                  style={{ background:'none', border:'none', cursor:'pointer', color:'var(--danger)', fontSize:16 }}>×</button>
              </div>
            ))}
            <button className="btn btn-secondary btn-sm" style={{ marginTop:6 }}
              onClick={()=>setProducts(prev=>[...prev,emptyRow()])}>+ Add Row</button>
          </div>

          <button className="btn btn-primary" style={{ marginTop:16, width:'100%' }}
            onClick={handleGenerate} disabled={submitting}>
            {submitting ? 'Generating…' : '⚡ Generate Internal Challan'}
          </button>
        </div>

        {/* History */}
        <div>
          {pending.length > 0 && (
            <div className="card" style={{ marginBottom:14 }}>
              <div className="card-title" style={{ color:'var(--warn)' }}>⏳ Pending Release ({pending.length})</div>
              <table>
                <thead><tr><th>Challan No.</th><th>To</th><th>Date</th></tr></thead>
                <tbody>
                  {pending.map((c,i)=>(
                    <tr key={i}>
                      <td className="mono" style={{ fontSize:11 }}>{c['Challan Number']}</td>
                      <td>{c.destination_location}</td>
                      <td style={{ fontSize:11 }}>{c['Generated DateTime']?.split(' ')[0]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {released.length > 0 && (
            <div className="card">
              <div className="card-title">✓ Recently Released</div>
              <table>
                <thead><tr><th>Challan No.</th><th>To</th><th>Display</th></tr></thead>
                <tbody>
                  {released.slice(0,10).map((c,i)=>(
                    <tr key={i}>
                      <td className="mono" style={{ fontSize:11 }}>{c['Challan Number']}</td>
                      <td style={{ fontSize:12 }}>{c.destination_location}</td>
                      <td style={{ fontSize:11, color: c.is_display?'var(--success)':'var(--muted)' }}>{c.is_display?'Yes':'—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main Warehouse Page ───────────────────────────────────────────────────────
export default function WarehousePage() {
  const [tab, setTab]                     = useState('receive');
  const [pendingChallanCount, setPCC]     = useState(0);
  const [pendingReceiptCount, setPRC]     = useState(0);

  useEffect(() => {
    // Badge counts
    fetch('/api/challan?status=awaiting_delivery&company=all&limit=1').then(r=>r.json()).then(d => setPCC(d.count||0));
    fetch('/api/inventory?pending=true&company=all&limit=1').then(r=>r.json()).then(d => setPRC(d.count||0));
  }, []);

  return (
    <div className="page">
      <h2 className="page-title">Warehouse Management</h2>
      <TabBar
        active={tab}
        onChange={setTab}
        tabs={[
          ['receive',    'Receive Stock',      pendingReceiptCount || null],
          ['dispatch',   'Dispatch',           pendingChallanCount || null],
          ['internal',   'Internal Transfer',  null],
          ['inventory',  'Inventory',          null],
          ['adjustments','Adjustments',        null],
        ]}
      />
      {tab === 'receive'     && <ReceiveStockTab />}
      {tab === 'dispatch'    && <DispatchTab />}
      {tab === 'inventory'   && <InventoryTab />}
      {tab === 'adjustments' && <AdjustmentsTab />}
      {tab === 'internal'    && <InternalTransferTab />}
    </div>
  );
}
