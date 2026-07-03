export const COMPANIES = {
  soma: {
    id: 'soma',
    name: 'Soma Company',
    prefix: 'SCC',
    address: 'Jawahar Nagar Colony, Bhelupur, Varanasi, UP - 221010',
    gstin: 'GSTIN: 09AAWFS0061M1ZK',
    phone: 'Phone: 0542-2275666, 0542-2277766, 98385 07052',
    defaultEmail: 'soma_comp@outlook.com',
  },
  nalanda: {
    id: 'nalanda',
    name: 'Nalanda & Company',
    prefix: 'NCC',
    address: 'Shiv Complex, Sunderpur, Varanasi, UP - 221005',
    gstin: 'GSTIN: 09AABFN8325Q1ZN',
    phone: 'Phone: 0542-2275801, 0542-3562254',
    defaultEmail: 'nalandacompany@gmail.com',
  },
  gangotri: {
    id: 'gangotri',
    name: 'Gangotri Enterprises',
    prefix: 'GEC',
    address: '',
    gstin: '',
    phone: '',
    defaultEmail: 'nalandacompany@gmail.com',
  },
};

export function getCompany(id) { return COMPANIES[id] || null; }

export function formatChallanNumber(prefix, year, month, seq) {
  return `${prefix}/${year}/${String(month).padStart(2,'0')}/${String(seq).padStart(3,'0')}`;
}

export function formatDate(date = new Date()) {
  return date.toLocaleDateString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric'
  }).replace(/ /g, '-');
}
