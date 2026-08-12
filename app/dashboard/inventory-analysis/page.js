'use client';
import { useState, useEffect, useMemo } from 'react';

const FMT_INR = v => Number(v||0).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2});
const MONTHS = ['April','May','June','July','August','September','October','November','December','January','February','March'];
const CUR_YEAR = new Date().getFullYear();
const CUR_FY   = new Date().getMonth() >= 3 ? CUR_YEAR : CUR_YEAR - 1;

function parseDMY(str) {
  if (!str) return null;
  const [d,m,y] = str.split('-').map(Number);
  return isNaN(d) ? null : new Date(y, m-1, d);
}

function ABCBadge({ cat }) {
  const s = { A:{background:'#d1fae5',color:'#065f46'}, B:{background:'#fef3c7',color:'#92400e'}, C:{background:'#fee2e2',color:'#991b1b'} };
  return <span style={{...s[cat],padding:'2px 8px',borderRadius:10,fontSize:11,fontWeight:700}}>{cat}</span>;
}

function BillingTab({ company }) {
  const [periodType, setPeriodType] = useState('year');
  const [fyYear,     setFyYear]     = useState(CUR_FY);
  const [month,      setMonth]      = useState(new Date().getMonth()+1);
  const [quarter,    setQuarter]    = useState(Math.ceil((new Date().getMonth()+1)/3));
  const [rows,       setRows]       = useState([]);
  const [grandTotal, setGrandTotal] = useState(0);
  const [trend,      setTrend]      = useState({});
  const [invCount,   setInvCount]   = useState(0);
  const [excluded,   setExcluded]   = useState(new Set());
  const [loading,    setLoading]    = useState(false);
  const [error,      setError]      = useState('');

  useEffect(() => { load(); }, [company, periodType, fyYear, month, quarter]);

  async function load() {
    setLoading(true); setError('');
    const p = new URLSearchParams({ company, period:periodType, fy_year:fyYear });
    if (periodType==='month')   p.set('month',   month);
    if (periodType==='quarter') p.set('quarter', quarter);
    const res = await fetch(`/api/billing?${p}`);
    const d   = await res.json();
    if (!res.ok) { setError(d.error); setLoading(false); return; }
    setRows(d.rows||[]); setGrandTotal(d.grandTotal||0);
    setTrend(d.monthlyTrend||{}); setInvCount(d.invoiceCount||0);
    setExcluded(new Set()); setLoading(false);
  }

  const included      = rows.filter(r => !excluded.has(r.salesman_code));
  const filteredTotal = included.reduce((s,r) => s+r.total_billing, 0);

  function toggleExclude(code) {
    setExcluded(prev => { const n=new Set(prev); n.has(code)?n.delete(code):n.add(code); return n; });
  }

  const trendEntries = Object.entries(trend).sort(([a],[b]) => a.localeCompare(b));
  const maxTrend     = Math.max(...trendEntries.map(([,v])=>v), 1);

  const periodLabel = periodType==='month'
    ? `${MONTHS[(month-4+12)%12]} FY${fyYear}-${String(fyYear+1).slice(2)}`
    : periodType==='quarter' ? `Q${quarter} FY${fyYear}-${String(fyYear+1).slice(2)}`
    : `FY ${fyYear}-${String(fyYear+1).slice(2)}`;

  return (
    <div>
      <div style={{display:'flex',gap:10,flexWrap:'wrap',marginBottom:16}}>
        <select value={periodType} onChange={e=>setPeriodType(e.target.value)} style={{maxWidth:140}}>
          <option value="month">Monthly</option>
          <option value="quarter">Quarterly</option>
          <option value="year">Annual (FY)</option>
        </select>
        <select value={fyYear} onChange={e=>setFyYear(Number(e.target.value))} style={{maxWidth:140}}>
          {[CUR_FY,CUR_FY-1,CUR_FY-2].map(y=><option key={y} value={y}>FY {y}-{String(y+1).slice(2)}</option>)}
        </select>
        {periodType==='quarter' && (
          <select value={quarter} onChange={e=>setQuarter(Number(e.target.value))} style={{maxWidth:130}}>
            <option value={1}>Q1 (Apr–Jun)</option><option value={2}>Q2 (Jul–Sep)</option>
            <option value={3}>Q3 (Oct–Dec)</option><option value={4}>Q4 (Jan–Mar)</option>
          </select>
        )}
        {periodType==='month' && (
          <select value={month} onChange={e=>setMonth(Number(e.target.value))} style={{maxWidth:130}}>
            {MONTHS.map((m,i)=>{const cal=((i+3)%12)+1;return <option key={i} value={cal}>{m}</option>;})}
          </select>
        )}
        <button className="btn btn-secondary btn-sm" onClick={load}>↻ Refresh</button>
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {loading ? <div className="spinner"/> : (<>
        <div style={{display:'flex',gap:12,marginBottom:18,flexWrap:'wrap'}}>
          {[
            [periodLabel+' — Total Billing', `₹${FMT_INR(filteredTotal)}`, excluded.size>0?`${excluded.size} excluded`:''],
            ['Invoices', invCount, ''],
            ['Salesmen', rows.length, ''],
          ].map(([label,val,sub],i)=>(
            <div key={i} className="card" style={{padding:'12px 18px',minWidth:150}}>
              <div style={{fontSize:11,color:'var(--muted)'}}>{label}</div>
              <div style={{fontSize:i===0?20:22,fontWeight:800,fontFamily:'var(--font-mono)'}}>{val}</div>
              {sub && <div style={{fontSize:10,color:'var(--muted)'}}>{sub}</div>}
            </div>
          ))}
        </div>

        {rows.length===0 ? (
          <p style={{color:'var(--muted)',fontSize:13}}>No billing data for this period. Invoices imported after running migration v7 will appear here.</p>
        ) : (<>
          <table>
            <thead><tr><th style={{width:32}}></th><th>Salesman</th><th style={{textAlign:'right'}}>Invoices</th><th style={{textAlign:'right'}}>Taxable Value (₹)</th><th style={{textAlign:'right'}}>% of Total</th></tr></thead>
            <tbody>
              {rows.map((r,i) => {
                const isEx = excluded.has(r.salesman_code);
                const pct  = grandTotal>0 ? (r.total_billing/grandTotal*100).toFixed(1) : '0.0';
                return (
                  <tr key={i} style={{opacity:isEx?0.4:1}}>
                    <td><input type="checkbox" checked={!isEx} onChange={()=>toggleExclude(r.salesman_code)} style={{width:'auto'}}/></td>
                    <td style={{fontWeight:500}}>{r.salesman_code}</td>
                    <td style={{textAlign:'right'}}>{r.invoice_count}</td>
                    <td style={{textAlign:'right',fontFamily:'var(--font-mono)',fontWeight:600}}>₹{FMT_INR(r.total_billing)}</td>
                    <td style={{textAlign:'right',color:'var(--muted)',fontFamily:'var(--font-mono)'}}>{pct}%</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr style={{borderTop:'2px solid var(--border)',fontWeight:800}}>
                <td colSpan={2}></td>
                <td style={{textAlign:'right'}}>{included.reduce((s,r)=>s+r.invoice_count,0)}</td>
                <td style={{textAlign:'right',fontFamily:'var(--font-mono)',fontSize:15}}>₹{FMT_INR(filteredTotal)}</td>
                <td style={{textAlign:'right',color:'var(--muted)',fontFamily:'var(--font-mono)'}}>{grandTotal>0?(filteredTotal/grandTotal*100).toFixed(1):100}%</td>
              </tr>
            </tfoot>
          </table>

          {trendEntries.length>1 && (
            <div className="card" style={{marginTop:20}}>
              <div className="card-title">Monthly Trend</div>
              <div style={{display:'flex',alignItems:'flex-end',gap:6,height:120,padding:'0 4px'}}>
                {trendEntries.map(([key,val],i)=>{
                  const h=Math.round((val/maxTrend)*100);
                  const [y,mo]=key.split('-');
                  const label=MONTHS[parseInt(mo)-1]?.slice(0,3)+' '+y.slice(2);
                  return (
                    <div key={i} style={{flex:1,display:'flex',flexDirection:'column',alignItems:'center',gap:3}}>
                      <div style={{fontSize:9,color:'var(--muted)',fontFamily:'var(--font-mono)'}}>{val>0?`₹${(val/100000).toFixed(1)}L`:''}</div>
                      <div title={`₹${FMT_INR(val)}`} style={{width:'100%',height:`${h}%`,minHeight:2,background:'var(--primary)',borderRadius:'3px 3px 0 0'}}/>
                      <div style={{fontSize:9,color:'var(--muted)',whiteSpace:'nowrap'}}>{label}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>)}
      </>)}
    </div>
  );
}

function InventoryAnalysisTab({ company }) {
  const [items,   setItems]   = useState([]);
  const [dispatched, setDisp] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');

  useEffect(() => { load(); }, [company]);

  async function load() {
    setLoading(true); setError('');
    // Only the columns these calculations actually use — keeps the payload small
    const FREE_FIELDS = 'id,product_code,product_name,quantity,price,input_date';
    const DISP_FIELDS = 'id,product_code,quantity,updated_at';
    try {
      const [fRes, dRes] = await Promise.all([
        fetch(`/api/inventory?company=${company}&status=free&pending=false&limit=20000&fields=${FREE_FIELDS}`),
        fetch(`/api/inventory?company=${company}&status=dispatched&limit=20000&fields=${DISP_FIELDS}`),
      ]);
      if (!fRes.ok || !dRes.ok) {
        throw new Error(`Server returned ${!fRes.ok ? fRes.status : dRes.status}. Try narrowing the company filter.`);
      }
      const { data: free } = await fRes.json();
      const { data: disp } = await dRes.json();
      setItems(free || []);
      setDisp(disp || []);
    } catch (e) {
      setError(e.message || 'Failed to load inventory data.');
      setItems([]); setDisp([]);
    } finally {
      setLoading(false);   // always clears — never leaves the page spinning
    }
  }

  const turnover = useMemo(() => {
    const now = Date.now(); const DAY = 86400000;
    const units = r => Number(r.quantity ?? 1) || 1;
    const avg = (items || []).reduce((s, r) => s + units(r), 0) || 1;
    const count = days => (dispatched||[])
      .filter(d => (now - new Date(d.updated_at).getTime()) <= days*DAY)
      .reduce((s, d) => s + units(d), 0);
    return { monthly: (count(30)/avg).toFixed(2), quarterly: (count(90)/avg).toFixed(2), annual: (count(365)/avg).toFixed(2) };
  }, [items, dispatched]);

  const { abcRows, agingItems } = useMemo(() => {
    if (!items.length) return { abcRows:[], agingItems:[] };
    const groups = {};
    for (const item of items) {
      const key = item.product_code || item.product_name || item.id;
      if (!groups[key]) groups[key] = { ln_code:item.product_code||'—', name:item.product_name||'—', count:0, totalCost:0, oldestDate:null };
      const units = Number(item.quantity ?? 1) || 1;
      groups[key].count     += units;
      groups[key].totalCost += (parseFloat(item.price)||0) * units;
      const d = parseDMY(item.input_date);
      if (d && (!groups[key].oldestDate || d < groups[key].oldestDate)) groups[key].oldestDate = d;
    }
    const sorted = Object.values(groups).sort((a,b) => b.totalCost - a.totalCost);
    const total  = sorted.reduce((s,r) => s+r.totalCost, 0);
    let cum = 0;
    const abcRows = sorted.map(r => {
      cum += r.totalCost;
      const pct = total>0 ? cum/total : 0;
      const abc = pct<=0.70 ? 'A' : pct<=0.90 ? 'B' : 'C';
      const ageDays = r.oldestDate ? Math.floor((Date.now()-r.oldestDate.getTime())/86400000) : 0;
      return { ...r, abc, ageDays, pct: total>0?r.totalCost/total*100:0 };
    });
    return { abcRows, agingItems: abcRows.filter(r=>r.ageDays>60) };
  }, [items]);

  const agingValue = agingItems.reduce((s,r)=>s+r.totalCost,0);
  const totalValue = abcRows.reduce((s,r)=>s+r.totalCost,0);

  return (
    <div>
      {error && <div className="alert alert-error">{error}</div>}
      {loading ? <div className="spinner"/> : (<>
        <div style={{display:'flex',gap:12,flexWrap:'wrap',marginBottom:18}}>
          <div className="card" style={{padding:'12px 18px',minWidth:160}}>
            <div style={{fontSize:11,color:'var(--muted)'}}>Total Stock Value</div>
            <div style={{fontSize:20,fontWeight:800,fontFamily:'var(--font-mono)'}}>₹{FMT_INR(totalValue)}</div>
            <div style={{fontSize:11,color:'var(--muted)'}}>{abcRows.reduce((s,r)=>s+r.count,0)} units · {abcRows.length} SKUs</div>
          </div>
          <div className="card" style={{padding:'12px 18px',minWidth:160,background:agingItems.length?'#fff7ed':undefined,borderColor:agingItems.length?'#f97316':undefined}}>
            <div style={{fontSize:11,color:agingItems.length?'#f97316':'var(--muted)'}}>⏰ Aging Stock (&gt;60 days)</div>
            <div style={{fontSize:20,fontWeight:800}}>{agingItems.length} SKUs</div>
            <div style={{fontSize:11,fontFamily:'var(--font-mono)',color:'#f97316'}}>₹{FMT_INR(agingValue)}</div>
          </div>
          <div className="card" style={{padding:'12px 18px',minWidth:220}}>
            <div style={{fontSize:11,color:'var(--muted)'}}>Inventory Turnover</div>
            <div style={{display:'flex',gap:16,marginTop:6}}>
              {[['Monthly',turnover.monthly],['Quarterly',turnover.quarterly],['Annual',turnover.annual]].map(([l,v])=>(
                <div key={l} style={{textAlign:'center'}}>
                  <div style={{fontSize:16,fontWeight:700,fontFamily:'var(--font-mono)'}}>{v}</div>
                  <div style={{fontSize:9,color:'var(--muted)'}}>{l}</div>
                </div>
              ))}
            </div>
            <div style={{fontSize:9,color:'var(--muted)',marginTop:4}}>dispatched ÷ avg. free stock</div>
          </div>
        </div>

        <div style={{display:'flex',gap:12,marginBottom:12,fontSize:12,color:'var(--muted)',flexWrap:'wrap'}}>
          <span><ABCBadge cat="A"/> Top 70% by cost</span>
          <span><ABCBadge cat="B"/> 70–90%</span>
          <span><ABCBadge cat="C"/> Bottom 10%</span>
          <span style={{marginLeft:8}}>🟠 &gt;60 days aging · 🔴 &gt;120 days aging</span>
        </div>

        {abcRows.length===0 ? <p style={{color:'var(--muted)',fontSize:13}}>No free stock found.</p> : (
          <table>
            <thead><tr><th>Cat.</th><th>Product</th><th>LN Code</th><th style={{textAlign:'right'}}>Units</th><th style={{textAlign:'right'}}>Cost Value (₹)</th><th style={{textAlign:'right'}}>% Total</th><th style={{textAlign:'right'}}>Oldest Unit</th></tr></thead>
            <tbody>
              {abcRows.map((r,i)=>(
                <tr key={i} style={{background:r.ageDays>120?'#fff1f2':r.ageDays>60?'#fff7ed':undefined}}>
                  <td><ABCBadge cat={r.abc}/></td>
                  <td style={{fontWeight:500}}>
                    {r.name}
                    {r.ageDays>60 && <span style={{marginLeft:6,fontSize:10,color:r.ageDays>120?'#dc2626':'#f97316',fontWeight:600}}>⏰ {r.ageDays}d</span>}
                  </td>
                  <td className="mono" style={{fontSize:11,color:'var(--muted)'}}>{r.ln_code}</td>
                  <td style={{textAlign:'right'}}>{r.count}</td>
                  <td style={{textAlign:'right',fontFamily:'var(--font-mono)',fontWeight:600}}>₹{FMT_INR(r.totalCost)}</td>
                  <td style={{textAlign:'right',fontFamily:'var(--font-mono)',color:'var(--muted)',fontSize:11}}>{r.pct.toFixed(1)}%</td>
                  <td style={{textAlign:'right',fontSize:11,color:r.ageDays>120?'#dc2626':r.ageDays>60?'#f97316':'var(--muted)'}}>
                    {r.oldestDate?r.oldestDate.toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'}):'—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <button className="btn btn-secondary btn-sm" style={{marginTop:12}} onClick={load}>↻ Refresh</button>
      </>)}
    </div>
  );
}

export default function InventoryAnalysisPage() {
  const [tab,     setTab]     = useState('billing');
  const [company, setCompany] = useState('soma');
  return (
    <div className="page">
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16,flexWrap:'wrap',gap:10}}>
        <h2 className="page-title" style={{margin:0}}>Inventory Analysis</h2>
        <select value={company} onChange={e=>setCompany(e.target.value)} style={{maxWidth:180}}>
          <option value="soma">Soma &amp; Co.</option>
          <option value="nalanda">Nalanda &amp; Co.</option>
          <option value="gangotri">Gangotri</option>
        </select>
      </div>
      <div style={{display:'flex',gap:4,marginBottom:20,borderBottom:'2px solid var(--border)'}}>
        {[['billing','Billing Analysis'],['inventory','Inventory Analysis']].map(([id,label])=>(
          <button key={id} onClick={()=>setTab(id)} style={{padding:'8px 18px',border:'none',cursor:'pointer',fontSize:13,fontWeight:600,background:tab===id?'var(--primary)':'transparent',color:tab===id?'#fff':'var(--muted)',borderRadius:'4px 4px 0 0'}}>
            {label}
          </button>
        ))}
      </div>
      {tab==='billing'   && <BillingTab   company={company}/>}
      {tab==='inventory' && <InventoryAnalysisTab company={company}/>}
    </div>
  );
}
