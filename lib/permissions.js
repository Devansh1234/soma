// Safe to import in both client and server components

export const DEFAULT_PERMISSIONS = {
  owner: {
    challan: true, free_stock: true, warehouse: true,
    order_booking: true, order_management: true,
    inventory_analysis: true, admin: true,
    rtc_challan: true, cancel_challan: true,
  },
  office_employee: {
    challan: true, free_stock: true, warehouse: false,
    order_booking: false, order_management: true,
    inventory_analysis: false, admin: false,
    rtc_challan: false, cancel_challan: false,
  },
  warehouse_employee: {
    challan: false, free_stock: true, warehouse: true,
    order_booking: false, order_management: false,
    inventory_analysis: false, admin: false,
    rtc_challan: true, cancel_challan: false,
  },
  retailer: {
    challan: false, free_stock: true, warehouse: false,
    order_booking: true, order_management: false,
    inventory_analysis: false, admin: false,
    rtc_challan: false, cancel_challan: false,
  },
};

export function getEffectivePermissions(user) {
  if (user.role === 'owner') return DEFAULT_PERMISSIONS.owner;
  const defaults = DEFAULT_PERMISSIONS[user.role] || {};
  return { ...defaults, ...(user.tab_permissions || {}) };
}

export function canAccess(user, tab) {
  return getEffectivePermissions(user)[tab] === true;
}

// CCID: "[First initial]-[Surname]-[ChallanNumber]"
// Single-name users: "[First initial]-[Full name]-[ChallanNumber]"
export function computeCCID(userName, challanNumber) {
  const parts = (userName || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return `U-${challanNumber}`;
  const initial = parts[0][0].toUpperCase();
  const surname = parts.length > 1 ? parts[parts.length - 1] : parts[0];
  return `${initial}-${surname}-${challanNumber}`;
}
