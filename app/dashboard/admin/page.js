'use client';
import { useState, useEffect } from 'react';
import { DEFAULT_PERMISSIONS } from '@/lib/permissions';

const ROLES = ['office_employee', 'warehouse_employee', 'retailer', 'owner'];
const COMPANIES = ['soma', 'nalanda', 'gangotri'];
const COMPANY_LABELS = { soma: 'Soma & Company', nalanda: 'Nalanda & Company', gangotri: 'Gangotri Enterprises' };
const ROLE_LABELS = { owner: 'Owner', office_employee: 'Office Employee', warehouse_employee: 'Warehouse Employee', retailer: 'Retailer' };

const ALL_TABS = [
  { key: 'challan',            label: 'Challan' },
  { key: 'free_stock',         label: 'Free Stock' },
  { key: 'warehouse',          label: 'Warehouse Mgt.' },
  { key: 'order_booking',      label: 'Order Booking' },
  { key: 'order_management',   label: 'Order Mgt.' },
  { key: 'inventory_analysis', label: 'Inv. Analysis' },
  { key: 'internal_challan',   label: 'Internal Challan' },
  { key: 'walkins',            label: 'Walk-in Tracker' },
  { key: 'admin',              label: 'Admin' },
];

const EMPTY_FORM = { email: '', name: '', password: '', role: 'office_employee', company: 'soma', tab_permissions: {} };

function PermissionsEditor({ role, value, onChange }) {
  if (role === 'owner') {
    return <span style={{ fontSize: 12, color: 'var(--success)' }}>All tabs (owner)</span>;
  }
  const defaults = DEFAULT_PERMISSIONS[role] || {};
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 16px' }}>
      {ALL_TABS.map(tab => {
        const effective = value[tab.key] !== undefined ? value[tab.key] : (defaults[tab.key] || false);
        const isDefault = value[tab.key] === undefined;
        return (
          <label key={tab.key} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={effective}
              style={{ width: 'auto' }}
              onChange={e => {
                const newPerms = { ...value };
                // If same as default, remove override; otherwise set explicitly
                if (e.target.checked === (defaults[tab.key] || false)) {
                  delete newPerms[tab.key];
                } else {
                  newPerms[tab.key] = e.target.checked;
                }
                onChange(newPerms);
              }}
            />
            <span style={{ color: isDefault ? 'var(--muted)' : 'var(--text)' }}>
              {tab.label}{isDefault ? ' (default)' : ''}
            </span>
          </label>
        );
      })}
    </div>
  );
}

function UserModal({ user, onSave, onClose }) {
  const isNew = !user.id;
  const [form, setForm] = useState(isNew ? { ...EMPTY_FORM } : {
    email: user.email,
    name: user.name,
    role: user.role,
    company: user.company,
    tab_permissions: user.tab_permissions || {},
    password: '',
    is_active: user.is_active,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const set = (field, val) => setForm(p => ({ ...p, [field]: val }));

  async function save() {
    if (!form.name || !form.email || (isNew && !form.password)) {
      setError('Name, email and password are required for new users.');
      return;
    }
    setSaving(true); setError('');
    const body = isNew
      ? { ...form }
      : { id: user.id, name: form.name, role: form.role, company: form.company, tab_permissions: form.tab_permissions, is_active: form.is_active, ...(form.password ? { password: form.password } : {}) };

    const res = await fetch('/api/users', {
      method: isNew ? 'POST' : 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    setSaving(false);
    if (res.ok) onSave();
    else { const d = await res.json(); setError(d.error); }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: '#fff', padding: 28, width: 640, maxHeight: '90vh', overflowY: 'auto' }}>
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
            <input type="email" value={form.email} onChange={e => set('email', e.target.value)} disabled={!isNew} placeholder="ramesh@company.in" />
          </div>
          <div className="form-group">
            <label>{isNew ? 'Password *' : 'New Password (leave blank to keep)'}</label>
            <input type="password" value={form.password} onChange={e => set('password', e.target.value)} placeholder={isNew ? 'Min 6 characters' : 'Leave blank to keep current'} />
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
          <label style={{ marginBottom: 8, display: 'block' }}>Tab Permissions</label>
          <PermissionsEditor
            role={form.role}
            value={form.tab_permissions}
            onChange={perms => set('tab_permissions', perms)}
          />
        </div>

        <div style={{ display: 'flex', gap: 10 }}>
          <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : isNew ? 'Create User' : 'Save Changes'}</button>
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

export default function AdminPage() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editUser, setEditUser] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    const res = await fetch('/api/users');
    if (res.ok) { const d = await res.json(); setUsers(d); }
    else { setError('Failed to load users (are you an owner?)'); }
    setLoading(false);
  }

  async function deactivate(id, isActive) {
    const action = isActive ? 'deactivate' : 're-activate';
    if (!confirm(`${action} this user?`)) return;
    const res = await fetch('/api/users', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, is_active: !isActive }),
    });
    if (res.ok) { setSuccess(`User ${action}d.`); load(); }
    else { const d = await res.json(); setError(d.error); }
  }

  const getEffective = (user) => {
    if (user.role === 'owner') return DEFAULT_PERMISSIONS.owner;
    return { ...(DEFAULT_PERMISSIONS[user.role] || {}), ...user.tab_permissions };
  };

  return (
    <div className="page">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2 className="page-title" style={{ margin: 0 }}>User Management</h2>
        <button className="btn btn-primary" onClick={() => setShowCreate(true)}>+ Create User</button>
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {success && <div className="alert alert-success">{success}</div>}

      {(editUser || showCreate) && (
        <UserModal
          user={editUser || {}}
          onSave={() => { setEditUser(null); setShowCreate(false); setSuccess('User saved.'); load(); }}
          onClose={() => { setEditUser(null); setShowCreate(false); }}
        />
      )}

      {loading ? <div className="spinner" /> : (
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Role</th>
              <th>Company</th>
              <th>Status</th>
              <th>Tab Access</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.length === 0 && <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--muted)' }}>No users found</td></tr>}
            {users.map(user => {
              const perms = getEffective(user);
              const activeTabs = ALL_TABS.filter(t => perms[t.key]).map(t => t.label);
              return (
                <tr key={user.id} style={{ opacity: user.is_active ? 1 : 0.5 }}>
                  <td style={{ fontWeight: 600 }}>{user.name}</td>
                  <td style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{user.email}</td>
                  <td><span style={{ fontSize: 12 }}>{ROLE_LABELS[user.role] || user.role}</span></td>
                  <td style={{ fontSize: 12 }}>{COMPANY_LABELS[user.company] || user.company}</td>
                  <td>
                    <span className={`badge ${user.is_active ? 'badge-confirmed' : 'badge-cancelled'}`}>
                      {user.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td style={{ fontSize: 11, color: 'var(--muted)' }}>{activeTabs.join(', ') || 'None'}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button className="btn btn-secondary btn-sm" style={{ marginRight: 4 }} onClick={() => setEditUser(user)}>Edit</button>
                    <button className={`btn btn-sm ${user.is_active ? 'btn-danger' : 'btn-secondary'}`} onClick={() => deactivate(user.id, user.is_active)}>
                      {user.is_active ? 'Disable' : 'Enable'}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <div className="card" style={{ marginTop: 24 }}>
        <div className="card-title">Default Tab Access by Role</div>
        <table>
          <thead>
            <tr>
              <th>Tab</th>
              <th>Owner</th>
              <th>Office Employee</th>
              <th>Warehouse Employee</th>
              <th>Retailer</th>
            </tr>
          </thead>
          <tbody>
            {ALL_TABS.map(tab => (
              <tr key={tab.key}>
                <td>{tab.label}</td>
                {['owner', 'office_employee', 'warehouse_employee', 'retailer'].map(role => (
                  <td key={role} style={{ textAlign: 'center' }}>
                    {DEFAULT_PERMISSIONS[role]?.[tab.key] ? '✓' : <span style={{ color: 'var(--border)' }}>—</span>}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <p style={{ fontSize: 11, color: 'var(--muted)', marginTop: 8 }}>
          Individual overrides set above take precedence over these defaults.
        </p>
      </div>
    </div>
  );
}
