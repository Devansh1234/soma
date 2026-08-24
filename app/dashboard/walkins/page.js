'use client';
import { useState, useEffect, useMemo } from 'react';

const SHOWROOMS = [
  { id: 'Soma Showroom',      company: 'soma'    },
  { id: 'Sunderpur Showroom', company: 'nalanda' },
];

const CATEGORIES = [
  { key: 'home_storage',   label: 'Home Storage (HS)' },
  { key: 'home_furniture', label: 'Home Furniture (HF)' },
  { key: 'kitchen',        label: 'Kitchen' },
  { key: 'b2b',            label: 'B2B (office)' },
  { key: 'security',       label: 'Security (safes/lockers)' },
  { key: 'mattress',       label: 'Mattress' },
  { key: 'krex3',          label: 'KreX3 (almirah)' },
  { key: 'other',          label: 'Other' },
];

const INR  = v => Number(v || 0).toLocaleString('en-IN');
const today = () => new Date().toISOString().split('T')[0];
const yesterday = () => {
  const d = new Date(); d.setDate(d.getDate() - 1);
  return d.toISOString().split('T')[0];
};

// ── DAILY ENTRY ─────────────────────────────────────────────────────────────
function EntryTab() {
  const [date,        setDate]        = useState(yesterday);
  const [showroom,    setShowroom]    = useState(SHOWROOMS[0].id);
  const [walkins,     setWalkins]     = useState('');
  const [conversions, setConversions] = useState('');
  const [total,       setTotal]       = useState('');
  const [includesGst, setIncludesGst] = useState(true);
  const [cats,        setCats]        = useState({});
  const [sms,         setSms]         = useState({});
  const [newName,     setNewName]     = useState('');
  const [known,       setKnown]       = useState([]);
  const [notes,       setNotes]       = useState('');
  const [saving,      setSaving]      = useState(false);
  const [error,       setError]       = useState('');
  const [success,     setSuccess]     = useState('');
  const [existing,    setExisting]    = useState(false);

  const company = SHOWROOMS.find(s => s.id === showroom)?.company || 'soma';

  useEffect(() => { loadSalesmen(); }, [showroom]);
  useEffect(() => { loadExisting(); }, [date, showroom]);

  async function loadSalesmen() {
    try {
      const d = await fetch(`/api/walkins?mode=salesmen&showroom=${encodeURIComponent(showroom)}`).then(r => r.json());
      setKnown((d.salesmen || []).map(s => s.name));
    } catch { setKnown([]); }
  }

  async function loadExisting() {
    try {
      const d = await fetch(`/api/walkins?mode=day&date=${date}&showroom=${encodeURIComponent(showroom)}`).then(r => r.json());
      if (d.day) {
        setExisting(true);
        setWalkins(String(d.day.walkins ?? ''));
        setConversions(String(d.day.conversions ?? ''));
        setTotal(String(d.day.total_amount ?? ''));
        setIncludesGst(d.day.includes_gst !== false);
        setNotes(d.day.notes || '');
        const c = {}; (d.categories || []).forEach(r => { c[r.category] = String(r.amount); });
        const s = {}; (d.salesmen   || []).forEach(r => { s[r.salesman_name] = String(r.amount); });
        setCats(c); setSms(s);
      } else {
        setExisting(false);
        setWalkins(''); setConversions(''); setTotal(''); setNotes('');
        setCats({}); setSms({});
      }
    } catch { /* leave form as-is */ }
  }

  const catTotal = useMemo(
    () => Object.values(cats).reduce((s, v) => s + (parseFloat(v) || 0), 0), [cats]);
  const smTotal = useMemo(
    () => Object.values(sms).reduce((s, v) => s + (parseFloat(v) || 0), 0), [sms]);
  const stated = parseFloat(total) || 0;

  const catMismatch = stated > 0 && Math.abs(catTotal - stated) > 0.5;
  const smMismatch  = stated > 0 && Math.abs(smTotal  - stated) > 0.5;
  const convInvalid = walkins !== '' && conversions !== '' && Number(conversions) > Number(walkins);

  function addSalesman(name) {
    const n = (name || '').trim();
    if (!n) return;
    setSms(p => ({ ...p, [n]: p[n] ?? '' }));
    setNewName('');
  }

  async function save() {
    setError(''); setSuccess('');
    if (convInvalid) { setError('Conversions cannot exceed walk-ins.'); return; }
    setSaving(true);
    try {
      const res = await fetch('/api/walkins', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entry_date: date, showroom, company,
          walkins: Number(walkins) || 0,
          conversions: Number(conversions) || 0,
          total_amount: stated,
          includes_gst: includesGst,
          categories: Object.fromEntries(Object.entries(cats).map(([k, v]) => [k, parseFloat(v) || 0])),
          salesmen:   Object.fromEntries(Object.entries(sms).map(([k, v]) => [k, parseFloat(v) || 0])),
          notes,
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || `Server returned ${res.status}`);
      setSuccess(`Saved ${showroom} for ${date}.`);
      setExisting(true);
    } catch (e) {
      setError(e.message || 'Failed to save.');
    } finally {
      setSaving(false);
    }
  }

  const namesToShow = Array.from(new Set([...known, ...Object.keys(sms)]));

  return (
    <div>
      {error   && <div className="alert alert-error">{error}</div>}
      {success && <div className="alert alert-success">{success}</div>}
      {existing && !success && (
        <div className="alert" style={{ background:'#fff7ed', border:'1px solid #f97316', color:'#9a3412' }}>
          An entry already exists for this date and showroom — saving will overwrite it.
        </div>
      )}

      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:20, alignItems:'start' }}>
        {/* Left: day totals + categories */}
        <div className="card">
          <div className="card-title">Day Details</div>
          <div className="form-grid">
            <div className="form-group">
              <label>Date</label>
              <input type="date" value={date} onChange={e => setDate(e.target.value)} />
            </div>
            <div className="form-group">
              <label>Showroom</label>
              <select value={showroom} onChange={e => setShowroom(e.target.value)}>
                {SHOWROOMS.map(s => <option key={s.id} value={s.id}>{s.id}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label>Walk-ins (W)</label>
              <input type="number" min={0} value={walkins} onChange={e => setWalkins(e.target.value)} placeholder="6" />
            </div>
            <div className="form-group">
              <label>Conversions (Pur / C)</label>
              <input type="number" min={0} value={conversions} onChange={e => setConversions(e.target.value)} placeholder="5"
                style={{ borderColor: convInvalid ? 'var(--danger)' : undefined }} />
            </div>
            <div className="form-group">
              <label>Total / Order Booking (₹)</label>
              <input type="number" min={0} step="0.01" value={total} onChange={e => setTotal(e.target.value)} placeholder="165400" />
            </div>
            <div className="form-group" style={{ flexDirection:'row', alignItems:'center', gap:8, marginTop:22 }}>
              <input type="checkbox" id="gstChk" checked={includesGst}
                onChange={e => setIncludesGst(e.target.checked)} style={{ width:'auto' }} />
              <label htmlFor="gstChk" style={{ margin:0 }}>Amounts include GST</label>
            </div>
          </div>
          {convInvalid && (
            <div style={{ fontSize:11, color:'var(--danger)', marginTop:4 }}>
              Conversions ({conversions}) exceed walk-ins ({walkins}).
            </div>
          )}

          <div className="card-title" style={{ marginTop:18 }}>Sales by Category (₹)</div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 130px', gap:6, alignItems:'center' }}>
            {CATEGORIES.map(c => (
              <>
                <label key={c.key+'l'} style={{ fontSize:12, margin:0 }}>{c.label}</label>
                <input key={c.key+'i'} type="number" min={0} step="0.01" placeholder="0"
                  value={cats[c.key] ?? ''}
                  onChange={e => setCats(p => ({ ...p, [c.key]: e.target.value }))} />
              </>
            ))}
          </div>
          <div style={{ display:'flex', justifyContent:'space-between', marginTop:10, paddingTop:8,
            borderTop:'1px solid var(--border)', fontWeight:700, fontSize:13 }}>
            <span>Category total</span>
            <span style={{ fontFamily:'var(--font-mono)', color: catMismatch ? 'var(--danger)' : 'var(--success)' }}>
              ₹{INR(catTotal)}
            </span>
          </div>
          {catMismatch && (
            <div style={{ fontSize:11, color:'var(--danger)', marginTop:4 }}>
              Doesn't match the stated total (₹{INR(stated)}) — difference ₹{INR(Math.abs(catTotal - stated))}.
            </div>
          )}
        </div>

        {/* Right: salesmen */}
        <div className="card">
          <div className="card-title">Sales by Salesman (₹)</div>
          <p style={{ fontSize:11, color:'var(--muted)', marginBottom:10 }}>
            Leave blank or zero for anyone who sold nothing.
          </p>

          <div style={{ display:'grid', gridTemplateColumns:'1fr 130px 28px', gap:6, alignItems:'center' }}>
            {namesToShow.map(n => (
              <>
                <label key={n+'l'} style={{ fontSize:12, margin:0 }}>{n}</label>
                <input key={n+'i'} type="number" min={0} step="0.01" placeholder="0"
                  value={sms[n] ?? ''}
                  onChange={e => setSms(p => ({ ...p, [n]: e.target.value }))} />
                <button key={n+'x'} type="button" title="Remove from this day"
                  onClick={() => setSms(p => { const q = { ...p }; delete q[n]; return q; })}
                  style={{ background:'none', border:'none', cursor:'pointer', color:'var(--muted)', fontSize:15 }}>×</button>
              </>
            ))}
          </div>

          <div style={{ display:'flex', gap:6, marginTop:12 }}>
            <input value={newName} onChange={e => setNewName(e.target.value)}
              placeholder="Add salesman name…"
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addSalesman(newName); } }} />
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => addSalesman(newName)}>+ Add</button>
          </div>

          <div style={{ display:'flex', justifyContent:'space-between', marginTop:14, paddingTop:8,
            borderTop:'1px solid var(--border)', fontWeight:700, fontSize:13 }}>
            <span>Salesman total</span>
            <span style={{ fontFamily:'var(--font-mono)', color: smMismatch ? 'var(--danger)' : 'var(--success)' }}>
              ₹{INR(smTotal)}
            </span>
          </div>
          {smMismatch && (
            <div style={{ fontSize:11, color:'var(--danger)', marginTop:4 }}>
              Doesn't match the stated total (₹{INR(stated)}) — difference ₹{INR(Math.abs(smTotal - stated))}.
            </div>
          )}

          <div className="form-group" style={{ marginTop:16 }}>
            <label>Notes (optional)</label>
            <input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Anything worth recording" />
          </div>

          <button className="btn btn-primary" style={{ marginTop:14, width:'100%' }}
            onClick={save} disabled={saving || convInvalid}>
            {saving ? 'Saving…' : existing ? 'Update Entry' : 'Save Entry'}
          </button>
          {(catMismatch || smMismatch) && (
            <p style={{ fontSize:11, color:'var(--muted)', marginTop:8, textAlign:'center' }}>
              Totals don't match, but you can still save if that's correct.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// ── ANALYSIS ────────────────────────────────────────────────────────────────
function AnalysisTab() {
  const monthStart = () => { const d = new Date(); d.setDate(1); return d.toISOString().split('T')[0]; };
  const [showroom, setShowroom] = useState('all');
  const [start,    setStart]    = useState(monthStart);
  const [end,      setEnd]      = useState(today);
  const [data,     setData]     = useState(null);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState('');

  useEffect(() => { load(); }, [showroom, start, end]);

  async function load() {
    setLoading(true); setError('');
    try {
      const p = new URLSearchParams({ showroom, start, end });
      const res = await fetch(`/api/walkins/analysis?${p}`);
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || `Server returned ${res.status}`);
      setData(d);
    } catch (e) {
      setError(e.message || 'Failed to load analysis.');
      setData(null);
    } finally {
      setLoading(false);
    }
  }

  const catLabel = k => CATEGORIES.find(c => c.key === k)?.label || k;
  const maxCat = Math.max(...((data?.categories || []).map(c => c.amount)), 1);
  const maxSm  = Math.max(...((data?.salesmen   || []).map(s => s.amount)), 1);

  return (
    <div>
      <div style={{ display:'flex', gap:10, flexWrap:'wrap', marginBottom:16 }}>
        <select value={showroom} onChange={e => setShowroom(e.target.value)} style={{ maxWidth:200 }}>
          <option value="all">Both showrooms</option>
          {SHOWROOMS.map(s => <option key={s.id} value={s.id}>{s.id}</option>)}
        </select>
        <input type="date" value={start} onChange={e => setStart(e.target.value)} style={{ maxWidth:160 }} />
        <input type="date" value={end}   onChange={e => setEnd(e.target.value)}   style={{ maxWidth:160 }} />
        <button className="btn btn-secondary btn-sm" onClick={load}>↻ Refresh</button>
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {loading ? <div className="spinner" /> : !data ? null : (<>
        <div style={{ display:'flex', gap:12, flexWrap:'wrap', marginBottom:20 }}>
          {[
            ['Total Sales',     `₹${INR(data.summary.total_sales)}`,   `${data.summary.days_reported} day(s) reported`],
            ['Walk-ins',        data.summary.total_walkins,             `${data.summary.total_conversions} converted`],
            ['Conversion Rate', `${data.summary.conversion_rate}%`,     'converted ÷ walk-ins'],
            ['Avg Ticket',      `₹${INR(data.summary.avg_ticket)}`,     'sales ÷ conversions'],
          ].map(([label, val, sub], i) => (
            <div key={i} className="card" style={{ padding:'12px 18px', minWidth:150 }}>
              <div style={{ fontSize:11, color:'var(--muted)' }}>{label}</div>
              <div style={{ fontSize:20, fontWeight:800, fontFamily:'var(--font-mono)' }}>{val}</div>
              <div style={{ fontSize:10, color:'var(--muted)' }}>{sub}</div>
            </div>
          ))}
        </div>

        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:20 }}>
          <div className="card">
            <div className="card-title">Sales by Category</div>
            {!data.categories.length ? <p style={{ fontSize:12, color:'var(--muted)' }}>No data.</p> : (
              <table>
                <thead><tr><th>Category</th><th style={{textAlign:'right'}}>Amount (₹)</th><th style={{width:100}}></th></tr></thead>
                <tbody>
                  {data.categories.map((c,i) => (
                    <tr key={i}>
                      <td style={{fontSize:12}}>{catLabel(c.category)}</td>
                      <td style={{textAlign:'right',fontFamily:'var(--font-mono)',fontWeight:600}}>₹{INR(c.amount)}</td>
                      <td>
                        <div style={{ background:'var(--primary)', height:8, borderRadius:2,
                          width:`${Math.round(c.amount/maxCat*100)}%`, minWidth:2 }} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="card">
            <div className="card-title">Salesman Leaderboard</div>
            {!data.salesmen.length ? <p style={{ fontSize:12, color:'var(--muted)' }}>No data.</p> : (
              <table>
                <thead><tr><th>#</th><th>Salesman</th><th style={{textAlign:'right'}}>Amount (₹)</th><th style={{width:80}}></th></tr></thead>
                <tbody>
                  {data.salesmen.map((s,i) => (
                    <tr key={i}>
                      <td style={{color:'var(--muted)',fontSize:12}}>{i+1}</td>
                      <td style={{fontWeight:500}}>{s.name}</td>
                      <td style={{textAlign:'right',fontFamily:'var(--font-mono)',fontWeight:600}}>₹{INR(s.amount)}</td>
                      <td>
                        <div style={{ background:'var(--success)', height:8, borderRadius:2,
                          width:`${Math.round(s.amount/maxSm*100)}%`, minWidth:2 }} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {data.series.length > 1 && (
          <div className="card" style={{ marginTop:20 }}>
            <div className="card-title">Daily Sales</div>
            <div style={{ display:'flex', alignItems:'flex-end', gap:3, height:120 }}>
              {(() => {
                const maxAmt = Math.max(...data.series.map(d => d.amount), 1);
                return data.series.map((d,i) => (
                  <div key={i} title={`${d.date}: ₹${INR(d.amount)} · ${d.conversions}/${d.walkins}`}
                    style={{ flex:1, display:'flex', flexDirection:'column', justifyContent:'flex-end', height:'100%' }}>
                    <div style={{ background:'var(--primary)', borderRadius:'2px 2px 0 0',
                      height:`${Math.round(d.amount/maxAmt*100)}%`, minHeight:2 }} />
                  </div>
                ));
              })()}
            </div>
            <div style={{ fontSize:10, color:'var(--muted)', marginTop:6 }}>
              {data.series[0]?.date} → {data.series[data.series.length-1]?.date}
            </div>
          </div>
        )}
      </>)}
    </div>
  );
}

// ── PAGE ────────────────────────────────────────────────────────────────────
export default function WalkinsPage() {
  const [tab, setTab] = useState('entry');
  return (
    <div className="page">
      <h2 className="page-title" style={{ marginBottom:16 }}>Walk-in Tracker</h2>
      <div style={{ display:'flex', gap:4, marginBottom:20, borderBottom:'2px solid var(--border)' }}>
        {[['entry','Daily Entry'],['analysis','Analysis']].map(([id,label]) => (
          <button key={id} onClick={() => setTab(id)}
            style={{ padding:'8px 18px', border:'none', cursor:'pointer', fontSize:13, fontWeight:600,
              background: tab===id ? 'var(--primary)' : 'transparent',
              color: tab===id ? '#fff' : 'var(--muted)', borderRadius:'4px 4px 0 0' }}>
            {label}
          </button>
        ))}
      </div>
      {tab === 'entry'    && <EntryTab />}
      {tab === 'analysis' && <AnalysisTab />}
    </div>
  );
}
