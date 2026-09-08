import { getToken } from 'next-auth/jwt'
import { NextRequest, NextResponse } from 'next/server'

export async function middleware(req: NextRequest) {
  const pathname = req.nextUrl.pathname

  // Login-sider er altid åbne
  if (
    pathname === '/portal/login' ||
    pathname === '/admin/login' ||
    pathname === '/chauffeur/login'
  ) return NextResponse.next()

  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET })

  // Chauffør-sider: kræver driver-rolle
  if (pathname.startsWith('/chauffeur')) {
    if (!token || token.role !== 'driver') {
      return NextResponse.redirect(new URL('/chauffeur/login', req.url))
    }
    return NextResponse.next()
  }

  // Ikke logget ind → send til login
  if (!token) {
    const loginUrl = new URL('/portal/login', req.url)
    loginUrl.searchParams.set('callbackUrl', pathname)
    return NextResponse.redirect(loginUrl)
  }

  // Admin-sider kræver admin-rolle
  if (pathname.startsWith('/admin') && token.role !== 'admin') {
    return NextResponse.redirect(new URL('/portal', req.url))
  }

  // Giv stien videre til server-komponenterne. Admin-layoutet bruger den til at
  // holde signage-begrænsede brugere inde på skærm-siderne — det tjek kræver et
  // databaseopslag og kan derfor ikke ligge her i Edge-middlewaren.
  const headers = new Headers(req.headers)
  headers.set('x-pathname', pathname)
  return NextResponse.next({ request: { headers } })
}

export const config = {
  matcher: ['/portal/:path*', '/admin/:path*', '/chauffeur/:path*'],
}
