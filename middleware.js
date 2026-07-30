import { NextResponse } from 'next/server';
import { getUserFromRequest } from './lib/auth';
import { DEFAULT_PERMISSIONS } from './lib/permissions';

// Map each route to the permission key required to access it
const ROUTE_PERMISSIONS = {
  '/dashboard/challan':            'challan',
  '/dashboard/free-stock':         'free_stock',
  '/dashboard/warehouse':          'warehouse',
  '/dashboard/order-booking':      'order_booking',
  '/dashboard/order-management':   'order_management',
  '/dashboard/inventory-analysis': 'inventory_analysis',
  '/dashboard/admin':              'admin',
};

// Ordered list for "redirect to first allowed tab"
const TAB_ORDER = [
  '/dashboard/challan',
  '/dashboard/free-stock',
  '/dashboard/warehouse',
  '/dashboard/order-booking',
  '/dashboard/order-management',
  '/dashboard/inventory-analysis',
  '/dashboard/admin',
];

function getEffectivePermissions(user) {
  if (user.role === 'owner') return DEFAULT_PERMISSIONS.owner;
  const defaults = DEFAULT_PERMISSIONS[user.role] || {};
  return { ...defaults, ...(user.tab_permissions || {}) };
}

export async function middleware(request) {
  const { pathname } = request.nextUrl;

  // Only protect /dashboard routes
  if (!pathname.startsWith('/dashboard')) return NextResponse.next();

  // Verify authentication
  const user = await getUserFromRequest(request);
  if (!user) {
    return NextResponse.redirect(new URL('/', request.url));
  }

  const perms = getEffectivePermissions(user);

  // /dashboard root — redirect to first allowed tab
  if (pathname === '/dashboard' || pathname === '/dashboard/') {
    const first = TAB_ORDER.find(path => perms[ROUTE_PERMISSIONS[path]]);
    return NextResponse.redirect(new URL(first || '/', request.url));
  }

  // Specific tab — check permission
  // Warehouse page is also accessible with only internal_challan permission
  // (page itself shows just the Internal Transfer tab in that case)
  const required = ROUTE_PERMISSIONS[pathname];
  const allowed  = required
    ? (perms[required] || (pathname === '/dashboard/warehouse' && perms.internal_challan))
    : true;
  if (required && !allowed) {
    // User doesn't have access — send them to their first allowed tab
    const first = TAB_ORDER.find(path => perms[ROUTE_PERMISSIONS[path]]);
    return NextResponse.redirect(new URL(first || '/', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/dashboard/:path*'],
};
