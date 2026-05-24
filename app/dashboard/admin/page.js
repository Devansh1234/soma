'use client';
import { useState, useEffect } from 'react';
import { DEFAULT_PERMISSIONS } from '@/lib/permissions';

const ROLES     = ['office_employee', 'warehouse_employee', 'retailer', 'owner'];
const COMPANIES = ['soma', 'nalanda', 'gangotri'];
const COMPANY_LABELS = { soma: 'Soma & Company', nalanda: 'Nalanda & Company', gangotri: 'Gangotri Enterprises' };
const ROLE_LABELS    = { owner: 'Owner', office_employee: 'Office Employee', warehouse_employee: 'Warehouse Employee', retailer: 'Retailer' };

const ALL_PERMISSIONS = [
  { key: 'challan',            label: 'Challan',           group: 'tabs' },
  { key: 'free_stock',         label: 'Free Stock',        group: 'tabs' },
  { key: 'warehouse',          label: 'Warehouse Mgt.',    group: 'tabs' },
  { key: 'order_booking',      label: 'Order Booking',     group: 'tabs' },
  { key: 'order_management',   label: 'Order Mgt.',        group: 'tabs' },
  { key: 'inventory_analysis', label: 'Inv. Analysis',     group: 'tabs' },
  { key: 'admin',              label: 'Admin',             group: 'tabs' },
  { key: 'rtc_challan',            label: 'Mark RTC',          group: 'actions' },
  { key: 'cancel_challan', label: 'Cancel Challans',   group: 'actions' },
];

const EMPTY_FORM = { email: '', name: '', password: '', role: 'office_employee', company: 'soma', tab_permissions: {} };

function PermissionsEditor({ role, value, onChange }) {
  if (role === 'owner') return <span style={{ fontSize: 12, color: 'var(--success)' }}>All permissions (owner)</span>;
  const defaults = DEFAULT_PERMISSIONS[role] || {};
  const tabs    = ALL_PERMISSIONS.filter(p => p.group === 'tabs');
  const actions = ALL_PERMISSIONS.filter(p => p.group === 'actions');

  const renderPerm = (perm) => {
    const effective  = value[perm.key] !== undefined ? value[perm.key] : (defaults[perm.key] || false);
    const isDefault  = value[perm.key] === undefined;
    return (
      <label key={perm.key} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, cursor: 'pointer' }}>
        <input type="checkbox" checked={effective} style={{ width: 'auto' }}
          onChange={e => {
            const n = { ...value };
            if (e.target.checked === (defaults[perm.key] || false)) delete n[perm.key];
            else n[perm.key] = e.target.checked;
            onChange(n);
          }}
        />
        <span style={{ color: isDefault ? 'var(--muted)' : 'var(--text)' }}>
          {perm.label}{isDefault ? ' (default)' : ''}
        </span>
      </label>
    );
  };

  return (
    <div>
      <div style={{ marginBottom: 8 }}>
        <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--muted)', marginBottom: 6 }}>Tab Access</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px 16px' }}>{tabs.map(renderPerm)}</div>
      </div>
      <div>
        <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--muted)', marginBottom: 6 }}>Actions</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px 16px' }}>{actions.map(renderPerm)}</div>
      </div>
    </div>
  );
}

function UserModal({ user, onSave, onClose }) {
  const isNew  = !user.id;
  const [form, setForm] = useState(isNew ? { ...EMPTY_FORM } : {
    email: user.email, name: user.name, role: user.role, company: user.company,
    tab_permissions: user.tab_permissions || {}, password: '', is_active: user.is_active,
  });
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState('');
  const set = (field, val) => setForm(p => ({ ...p, [field]: val }));

  async function save() {
    if (!form.name || !form.email || (isNew && !form.password)) {
      setError('Name, email and password required.'); return;
    }
    setSaving(true); setError('');
    const body = isNew
      ? { ...form }
      : { id: user.id, name: form.name, role: form.role, company: form.company,
          tab_permissions: form.tab_permissions, is_active: form.is_active,
          ...(form.password ? { password: form.password } : {}) };
    const res = await fetch('/api/users', { method: isNew ? 'POST' : 'PATCH',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    setSaving(false);
    if (res.ok) onSave();
    else { const d = await res.json(); setError(d.error); }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: '#fff', padding: 28, width: 660, maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 20 }}>
          <strong style={{ fontSize: 15 }}>{isNew ? 'Create New User' : `Edit: ${user.name}`}</strong>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 20 }}>×</button>
        </div>
        {error && <div className="alert alert-error">{error}</div>}
        <div className="form-grid" style={{ marginBottom: 16 }}>
          <div className="form-group">
            <label>Full Name *</label>
            <input value={form.name} onChange={e => set('name', e.target.value)} placeholder="Ramesh Kumar" />
          </div>
          <div className="form-group">
            <label>Email *</label>
            <input type="email" value={form.email} onChange={e => set('email', e.target.value)} disabled={!isNew} />
          </div>
          <div className="form-group">
            <label>{isNew ? 'Password *' : 'New Password (blank = keep)'}</label>
            <input type="password" value={form.password} onChange={e => set('password', e.target.value)} />
          </div>
          <div className="form-group">
            <label>Role *</label>
            <select value={form.role} onChange={e => { set('role', e.target.value); set('tab_permissions', {}); }}>
              {ROLES.map(r => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label>Company *</label>
            <select value={form.company} onChange={e => set('company', e.target.value)}>
              {COMPANIES.map(c => <option key={c} value={c}>{COMPANY_LABELS[c]}</option>)}
            </select>
          </div>
          {!isNew && (
            <div className="form-group">
              <label>Status</label>
              <select value={form.is_active ? 'active' : 'inactive'} onChange={e => set('is_active', e.target.value === 'active')}>
                <option value="active">Active</option>
                <option value="inactive">Inactive (blocked)</option>
              </select>
            </div>
          )}
        </div>
        <div style={{ marginBottom: 20 }}>
          <label style={{ marginBottom: 8, display: 'block' }}>Permissions</label>
          <PermissionsEditor role={form.role} value={form.tab_permissions} onChange={p => set('tab_permissions', p)} />
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : isNew ? 'Create User' : 'Save'}</button>
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

export default function AdminPage() {
  const [users,     setUsers]     = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [editUser,  setEditUser]  = useState(null);
  const [showCreate,setShowCreate]= useState(false);
  const [error,     setError]     = useState('');
  const [success,   setSuccess]   = useState('');

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    const res = await fetch('/api/users');
    if (res.ok) { const d = await res.json(); setUsers(d); }
    else setError('Failed to load users (owners only).');
    setLoading(false);
  }

  async function toggleActive(id, isActive) {
    if (!confirm(`${isActive ? 'Disable' : 'Enable'} this user?`)) return;
    const res = await fetch('/api/users', { method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, is_active: !isActive }) });
    if (res.ok) { setSuccess('User updated.'); load(); }
    else { const d = await res.json(); setError(d.error); }
  }

  const getEffective = u => {
    if (u.role === 'owner') return DEFAULT_PERMISSIONS.owner;
    return { ...(DEFAULT_PERMISSIONS[u.role] || {}), ...u.tab_permissions };
  };

  const tabPerms    = ALL_PERMISSIONS.filter(p => p.group === 'tabs');
  const actionPerms = ALL_PERMISSIONS.filter(p => p.group === 'actions');

  return (
    <div className="page">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2 className="page-title" style={{ margin: 0 }}>User Management</h2>
        <button className="btn btn-primary" onClick={() => setShowCreate(true)}>+ Create User</button>
      </div>

      {error   && <div className="alert alert-error">{error}</div>}
      {success && <div className="alert alert-success">{success}</div>}

      {(editUser || showCreate) && (
        <UserModal
          user={editUser || {}}
          onSave={() => { setEditUser(null); setShowCreate(false); setSuccess('Saved.'); load(); }}
          onClose={() => { setEditUser(null); setShowCreate(false); }}
        />
      )}

      {loading ? <div className="spinner" /> : (
        <table>
          <thead>
            <tr>
              <th>Name</th><th>Email</th><th>Role</th><th>Company</th><th>Status</th>
              <th>Tabs</th><th>RTC</th><th>Cancel</th><th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.length === 0 && <tr><td colSpan={9} style={{ textAlign: 'center', color: 'var(--muted)' }}>No users</td></tr>}
            {users.map(u => {
              const p = getEffective(u);
              const activeTabs = tabPerms.filter(t => p[t.key]).map(t => t.label).join(', ');
              return (
                <tr key={u.id} style={{ opacity: u.is_active ? 1 : 0.5 }}>
                  <td style={{ fontWeight: 600 }}>{u.name}</td>
                  <td className="mono" style={{ fontSize: 11 }}>{u.email}</td>
                  <td style={{ fontSize: 12 }}>{ROLE_LABELS[u.role] || u.role}</td>
                  <td style={{ fontSize: 12 }}>{COMPANY_LABELS[u.company] || u.company}</td>
                  <td><span className={`badge ${u.is_active ? 'badge-confirmed' : 'badge-cancelled'}`}>{u.is_active ? 'Active' : 'Inactive'}</span></td>
                  <td style={{ fontSize: 11, color: 'var(--muted)' }}>{activeTabs || 'None'}</td>
                  <td style={{ textAlign: 'center' }}>{p.rtc_challan ? '✓' : <span style={{ color: 'var(--border)' }}>—</span>}</td>
                  <td style={{ textAlign: 'center' }}>{p.cancel_challan ? '✓' : <span style={{ color: 'var(--border)' }}>—</span>}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button className="btn btn-secondary btn-sm" style={{ marginRight: 4 }} onClick={() => setEditUser(u)}>Edit</button>
                    <button className={`btn btn-sm ${u.is_active ? 'btn-danger' : 'btn-secondary'}`} onClick={() => toggleActive(u.id, u.is_active)}>
                      {u.is_active ? 'Disable' : 'Enable'}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <div className="card" style={{ marginTop: 24 }}>
        <div className="card-title">Default Permissions by Role</div>
        <table>
          <thead>
            <tr><th>Permission</th><th>Owner</th><th>Office Emp.</th><th>Warehouse Emp.</th><th>Retailer</th></tr>
          </thead>
          <tbody>
            {ALL_PERMISSIONS.map(perm => (
              <tr key={perm.key}>
                <td>{perm.label}{perm.group === 'actions' ? <span style={{ fontSize: 10, color: 'var(--muted)', marginLeft: 6 }}>(action)</span> : ''}</td>
                {['owner','office_employee','warehouse_employee','retailer'].map(role => (
                  <td key={role} style={{ textAlign: 'center' }}>
                    {DEFAULT_PERMISSIONS[role]?.[perm.key] ? '✓' : <span style={{ color: 'var(--border)' }}>—</span>}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <p style={{ fontSize: 11, color: 'var(--muted)', marginTop: 8 }}>Per-user overrides set above take precedence over these defaults.</p>
      </div>
    </div>
  );
}
