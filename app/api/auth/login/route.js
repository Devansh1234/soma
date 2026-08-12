import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { supabase } from '@/lib/supabase';
import { signToken, COOKIE_NAME } from '@/lib/auth';

// Throttling thresholds — failures inside the window lock further attempts.
const WINDOW_MINUTES = 15;
const MAX_EMAIL_FAILURES = 5;   // per account
const MAX_IP_FAILURES    = 20;  // per source IP (higher: an office shares one IP)

function getClientIp(request) {
  // Vercel sets x-forwarded-for; the first entry is the real client.
  const fwd = request.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0].trim();
  return request.headers.get('x-real-ip') || null;
}

// Recording an attempt must never break login itself.
async function recordAttempt(email, ip, succeeded) {
  try {
    await supabase.from('login_attempts').insert({ email, ip, succeeded });
  } catch (e) {
    console.error('login_attempts insert failed:', e);
  }
}

export async function POST(request) {
  try {
    const { email, password } = await request.json();
    if (!email || !password) {
      return NextResponse.json({ error: 'Email and password required' }, { status: 400 });
    }

    const cleanEmail = email.toLowerCase().trim();
    const ip = getClientIp(request);

    // ── Rate limit check ────────────────────────────────────────────────────
    // Fail open: if the check itself errors, allow the attempt through rather
    // than locking everyone out of the app.
    try {
      const { data: limits } = await supabase.rpc('recent_failed_logins', {
        p_email:   cleanEmail,
        p_ip:      ip,
        p_minutes: WINDOW_MINUTES,
      });
      const row = Array.isArray(limits) ? limits[0] : limits;
      const emailFailures = Number(row?.email_failures) || 0;
      const ipFailures    = Number(row?.ip_failures)    || 0;

      if (emailFailures >= MAX_EMAIL_FAILURES || ipFailures >= MAX_IP_FAILURES) {
        await recordAttempt(cleanEmail, ip, false);
        return NextResponse.json(
          { error: `Too many failed attempts. Please wait ${WINDOW_MINUTES} minutes and try again.` },
          { status: 429 }
        );
      }
    } catch (e) {
      console.error('Rate limit check failed, allowing attempt:', e);
    }

    // ── Credential check ────────────────────────────────────────────────────
    const { data: user, error } = await supabase
      .from('users')
      .select('*')
      .eq('email', cleanEmail)
      .eq('is_active', true)
      .single();

    if (error || !user) {
      await recordAttempt(cleanEmail, ip, false);
      return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      await recordAttempt(cleanEmail, ip, false);
      return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
    }

    // ── Success ─────────────────────────────────────────────────────────────
    await recordAttempt(cleanEmail, ip, true);

    // Clear this account's recent failures so a successful login resets the counter.
    try {
      await supabase
        .from('login_attempts')
        .delete()
        .eq('email', cleanEmail)
        .eq('succeeded', false);
    } catch (e) {
      console.error('Failed clearing login attempts:', e);
    }

    const token = await signToken({
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      company: user.company,
      tab_permissions: user.tab_permissions || {},
    });

    const response = NextResponse.json({
      ok: true,
      user: { name: user.name, role: user.role, company: user.company },
    });
    response.cookies.set(COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 60 * 60 * 8, // 8 hours
      path: '/',
      secure: process.env.NODE_ENV === 'production',
    });
    return response;
  } catch (err) {
    console.error('Login error:', err);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
