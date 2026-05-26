'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

// This page is just a redirect — the middleware handles it server-side,
// but this client-side fallback ensures /dashboard never shows raw content.
export default function DashboardPage() {
  const router = useRouter();

  useEffect(() => {
    fetch('/api/auth/me')
      .then(r => r.ok ? r.json() : null)
      .then(user => {
        if (!user) { router.replace('/'); return; }
        const perms = user.permissions || {};
        const tabs = [
          { key: 'challan',            path: '/dashboard/challan' },
          { key: 'free_stock',         path: '/dashboard/free-stock' },
          { key: 'warehouse',          path: '/dashboard/warehouse' },
          { key: 'order_booking',      path: '/dashboard/order-booking' },
          { key: 'order_management',   path: '/dashboard/order-management' },
          { key: 'inventory_analysis', path: '/dashboard/inventory-analysis' },
          { key: 'admin',              path: '/dashboard/admin' },
        ];
        const first = tabs.find(t => perms[t.key]);
        router.replace(first?.path || '/');
      })
      .catch(() => router.replace('/'));
  }, []);

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '80vh' }}>
      <div className="spinner" />
    </div>
  );
}
