<<<<<<< HEAD
# Challan & Warehouse Management System

Full-stack web app replacing the Windows Forms challan generator.
Stack: Next.js 14 · Supabase · Vercel (all free tier)

---

## Setup Instructions

### 1. Supabase — Run the schema

1. Open your Supabase project dashboard → SQL Editor
2. Run the contents of `database/schema.sql`
3. This creates: `users`, `companies`, `challan_counters`, `inventory`, `orders`, `order_items`
4. Your existing tables (`ChallanRecords`, `Customers`, `Products`, `ChallanCounter`) are left untouched

**First owner account created by the schema:**
- Email: `owner@somacompany.in`
- Password: `admin123`
- Change this immediately after first login via the Admin tab

To create a hash for a custom password, run:
```
node -e "const b=require('bcryptjs'); b.hash('yourpassword',12).then(console.log)"
```
Then UPDATE the users table row in Supabase.

### 2. Import your inventory

In Supabase SQL Editor or via the Table Editor:
- You can bulk-insert your Wix inventory CSV into the `inventory` table
- Required columns: `product_code`, `product_name`, `company`
- Map your Wix CSV columns to: Product Code → product_code, Product Name → product_name, etc.
- Set `company` to `'soma'` / `'nalanda'` / `'gangotri'` for each row
- Set `status` to `'free'` for all initial stock

Or use the Warehouse tab to add items manually after setup.

### 3. Environment variables

Copy `.env.local.example` to `.env.local` and fill in:

```
NEXT_PUBLIC_SUPABASE_URL=https://unnbtlatrbtnlqrieigz.supabase.co
SUPABASE_SERVICE_ROLE_KEY=  ← From Supabase: Settings → API → service_role key
JWT_SECRET=                 ← Run: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
ZEPTO_API_KEY=Zoho-enczapikey PHtE6r0MFu...  ← Your ZeptoMail key
ZEPTO_FROM_EMAIL=noreply@somacompany.in
ZEPTO_FROM_NAME=Challan System
```

**IMPORTANT:** Never commit `.env.local` to git. Add it to `.gitignore`.

### 4. Run locally

```bash
npm install
npm run dev
# Visit http://localhost:3000
```

### 5. Deploy to Vercel (free)

1. Push this folder to a GitHub repository
2. Go to vercel.com → New Project → Import from GitHub
3. Add all environment variables in Vercel dashboard (Project → Settings → Environment Variables)
4. Deploy — Vercel auto-detects Next.js, no config needed

---

## User Roles & Tab Access

| Tab               | Owner | Office Emp. | Warehouse Emp. | Retailer |
|-------------------|-------|-------------|----------------|----------|
| Challan           | ✓     | ✓ (default) | —              | —        |
| Free Stock        | ✓     | ✓ (default) | ✓              | ✓        |
| Warehouse Mgt.    | ✓     | —           | ✓              | —        |
| Order Booking     | ✓     | —           | —              | ✓        |
| Order Mgt.        | ✓     | ✓ (default) | —              | —        |
| Inv. Analysis     | ✓     | —           | —              | —        |
| Admin             | ✓     | —           | —              | —        |

Office employee access is customisable per-user via the Admin tab.

---

## Challan Numbering

- Soma & Company:     `SCC/YYYY/MM/NNN`
- Nalanda & Company:  `NCC/YYYY/MM/NNN`
- Gangotri Enterprises: `GEC/YYYY/MM/NNN`

Sequence resets every month. Numbers are generated atomically (no duplicates even with concurrent users).

---

## Adding Users

Only the Owner can create users. Go to Admin tab → Create User.
Retailers cannot self-register.

---

## Architecture Notes

- **Auth**: Custom JWT in httpOnly cookie (8-hour sessions). No Supabase Auth.
- **PDF**: Generated client-side with jsPDF. No server storage of PDFs — the record is in ChallanRecords, the PDF is downloaded locally.
- **Email**: ZeptoMail API via a Next.js API route (key never exposed to browser).
- **Database**: Service role key used server-side only — never in browser.
- **Existing data**: ChallanRecords, Customers, Products tables are reused as-is.
=======
# soma
>>>>>>> 6c1c92d7c8abdc6ae7eb70f45803cc4d1be78df2
