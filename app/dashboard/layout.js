'use client';
import { useState, useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';

const TABS = [
  { key: 'challan',            label: 'Challan',           path: '/dashboard/challan' },
  { key: 'free_stock',         label: 'Free Stock',        path: '/dashboard/free-stock' },
  { key: 'warehouse',          label: 'Warehouse',         path: '/dashboard/warehouse' },
  { key: 'order_booking',      label: 'Order Booking',     path: '/dashboard/order-booking' },
  { key: 'order_management',   label: 'Order Mgt.',        path: '/dashboard/order-management' },
  { key: 'inventory_analysis', label: 'Inv. Analysis',     path: '/dashboard/inventory-analysis' },
  { key: 'admin',              label: 'Admin',             path: '/dashboard/admin' },
];

const COMPANY_LABEL = { soma: 'Soma & Co.', nalanda: 'Nalanda & Co.', gangotri: 'Gangotri' };

export default function DashboardLayout({ children }) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState(null);

  useEffect(() => {
    fetch('/api/auth/me')
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (!d) { router.push('/'); return; }
        setUser(d);
      });
  }, []);

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/');
  }

  const visibleTabs = user
    ? TABS.filter(t => user.permissions?.[t.key])
    : [];

  return (
    <div>
      <nav className="nav no-print">
        <span className="nav-brand">▣ C&amp;W</span>
        {visibleTabs.map(tab => (
          <a
            key={tab.key}
            href={tab.path}
            className={`nav-tab ${pathname === tab.path ? 'active' : ''}`}
            onClick={e => { e.preventDefault(); router.push(tab.path); }}
          >
            {tab.label}
          </a>
        ))}
        <div className="nav-right">
          {user && (
            <>
              <span title={user.role}>{user.name}</span>
              <span style={{ color: '#666' }}>·</span>
              <span style={{ color: '#888' }}>{COMPANY_LABEL[user.company] || user.company}</span>
              <button
                onClick={logout}
                style={{ background: 'none', border: '1px solid #555', color: '#aaa', padding: '2px 10px', cursor: 'pointer', fontFamily: 'var(--font)', fontSize: 12, borderRadius: 2 }}
              >
                Logout
              </button>
            </>
          )}
        </div>
      </nav>
      <main>
        {children}
      </main>
    </div>
  );
}
