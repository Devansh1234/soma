import { NextResponse } from 'next/server';
import { getUserFromRequest } from './lib/auth';

export async function middleware(request) {
  const { pathname } = request.nextUrl;

  // Protect all /dashboard routes
  if (pathname.startsWith('/dashboard')) {
    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.redirect(new URL('/', request.url));
    }
    // Pass user data to headers so layout can read it
    const response = NextResponse.next();
    response.headers.set('x-user-id', user.id || '');
    response.headers.set('x-user-role', user.role || '');
    response.headers.set('x-user-company', user.company || '');
    return response;
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/dashboard/:path*'],
};
