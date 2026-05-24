import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { getCurrentUser } from '@/lib/auth';
import { supabase } from '@/lib/supabase';

async function requireOwner() {
  const user = await getCurrentUser();
  if (!user || user.role !== 'owner') {
    return [null, NextResponse.json({ error: 'Owner access required' }, { status: 403 })];
  }
  return [user, null];
}

export async function GET() {
  const [, denied] = await requireOwner();
  if (denied) return denied;

  const { data, error } = await supabase
    .from('users')
    .select('id, email, name, role, company, tab_permissions, is_active, created_at')
    .order('created_at', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function POST(request) {
  const [, denied] = await requireOwner();
  if (denied) return denied;

  const body = await request.json();
  const { email, name, password, role, company, tab_permissions } = body;

  if (!email || !name || !password || !role || !company) {
    return NextResponse.json({ error: 'All fields required' }, { status: 400 });
  }

  const password_hash = await bcrypt.hash(password, 12);

  const { data, error } = await supabase.from('users').insert({
    email: email.toLowerCase().trim(),
    name,
    password_hash,
    role,
    company,
    tab_permissions: tab_permissions || {},
    is_active: true,
  }).select('id, email, name, role, company, is_active').single();

  if (error) {
    if (error.code === '23505') return NextResponse.json({ error: 'Email already exists' }, { status: 409 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, data });
}

export async function PATCH(request) {
  const [, denied] = await requireOwner();
  if (denied) return denied;

  const body = await request.json();
  const { id, name, role, company, tab_permissions, is_active, password } = body;
  if (!id) return NextResponse.json({ error: 'ID required' }, { status: 400 });

  const updates = {};
  if (name !== undefined) updates.name = name;
  if (role !== undefined) updates.role = role;
  if (company !== undefined) updates.company = company;
  if (tab_permissions !== undefined) updates.tab_permissions = tab_permissions;
  if (is_active !== undefined) updates.is_active = is_active;
  if (password) updates.password_hash = await bcrypt.hash(password, 12);

  const { error } = await supabase.from('users').update(updates).eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(request) {
  const [, denied] = await requireOwner();
  if (denied) return denied;

  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'ID required' }, { status: 400 });

  // Soft delete (deactivate)
  const { error } = await supabase.from('users').update({ is_active: false }).eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
