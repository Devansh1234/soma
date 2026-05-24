-- ============================================================
-- CHALLAN APP - SUPABASE SCHEMA
-- Run this in your Supabase SQL Editor
-- ============================================================

-- USERS TABLE (custom auth, not Supabase Auth)
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner', 'office_employee', 'warehouse_employee', 'retailer')),
  company TEXT NOT NULL CHECK (company IN ('soma', 'nalanda', 'gangotri')),
  tab_permissions JSONB DEFAULT '{}',
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- COMPANIES TABLE (reference data)
CREATE TABLE IF NOT EXISTS companies (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  prefix TEXT NOT NULL,
  address TEXT,
  gstin TEXT,
  phone TEXT
);

INSERT INTO companies (id, name, prefix, address, gstin, phone) VALUES
  ('soma',      'Soma & Company',       'SCC', 'Jawahar Nagar Colony, Bhelupur, Varanasi, UP - 221010', 'GSTIN: 09AAWFS0061M1ZK', 'Phone: 0542-2275666, 0542-2277766, 98385 07052'),
  ('nalanda',   'Nalanda & Company',    'NCC', 'Shiv Complex, Sunderpur, Varanasi, UP - 221005',        'GSTIN: 09AABFN8325Q1ZN', 'Phone: 0542-2275801, 0542-3562254'),
  ('gangotri',  'Gangotri Enterprises', 'GEC', '',                                                       '',                       '')
ON CONFLICT (id) DO NOTHING;

-- CHALLAN COUNTERS (per company, per year-month — replaces the old single-row ChallanCounter)
CREATE TABLE IF NOT EXISTS challan_counters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company TEXT NOT NULL,
  year INT NOT NULL,
  month INT NOT NULL,
  current_number INT DEFAULT 0,
  UNIQUE (company, year, month)
);

-- Atomic increment function (prevents duplicate challan numbers)
CREATE OR REPLACE FUNCTION get_next_challan_number(p_company TEXT, p_year INT, p_month INT)
RETURNS INT LANGUAGE plpgsql AS $$
DECLARE v_number INT;
BEGIN
  INSERT INTO challan_counters (company, year, month, current_number)
    VALUES (p_company, p_year, p_month, 1)
  ON CONFLICT (company, year, month)
    DO UPDATE SET current_number = challan_counters.current_number + 1
  RETURNING current_number INTO v_number;
  RETURN v_number;
END;
$$;

-- INVENTORY TABLE
CREATE TABLE IF NOT EXISTS inventory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_code TEXT,
  product_name TEXT NOT NULL,
  packets_in_product TEXT,
  input_date TEXT,
  type_of_entry TEXT DEFAULT 'Manual',
  location TEXT,
  price NUMERIC,
  invoice_number TEXT,
  invoice_date TEXT,
  status TEXT DEFAULT 'free' CHECK (status IN ('free', 'committed', 'dispatched')),
  committed_to_order UUID,
  company TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_inventory_company ON inventory(company);
CREATE INDEX IF NOT EXISTS idx_inventory_status ON inventory(status);
CREATE INDEX IF NOT EXISTS idx_inventory_product_name ON inventory(product_name);

-- ORDERS TABLE
CREATE TABLE IF NOT EXISTS orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number TEXT UNIQUE NOT NULL,
  retailer_id UUID REFERENCES users(id),
  retailer_name TEXT,
  company TEXT NOT NULL,
  status TEXT DEFAULT 'booked' CHECK (status IN ('booked', 'confirmed', 'dispatched', 'cancelled')),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ORDER ITEMS TABLE
CREATE TABLE IF NOT EXISTS order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_name TEXT NOT NULL,
  quantity INT NOT NULL DEFAULT 1,
  price NUMERIC,
  inventory_item_id UUID REFERENCES inventory(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Auto-update updated_at timestamps
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

CREATE OR REPLACE TRIGGER trg_inventory_updated_at
  BEFORE UPDATE ON inventory
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE OR REPLACE TRIGGER trg_orders_updated_at
  BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- SEED: Create your first owner account
-- Password below is: admin123 (change immediately after first login via Admin tab)
-- Generate a new hash at: https://bcrypt-generator.com (12 rounds)
-- ============================================================
INSERT INTO users (email, name, password_hash, role, company, tab_permissions) VALUES
  ('owner@somacompany.in', 'Owner', '$2a$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMUMFOT8uyRNJLsv7VoPLPmO.', 'owner', 'soma', '{}')
ON CONFLICT (email) DO NOTHING;

-- ============================================================
-- NOTE: The existing tables (ChallanRecords, Customers, Products, ChallanCounter)
-- are left untouched. This app reads from/writes to them as-is.
-- ============================================================
