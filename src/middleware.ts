import { getToken } from 'next-auth/jwt'
import { NextRequest, NextResponse } from 'next/server'

/** Hvor hver rolle hører hjemme. Bruges når nogen er havnet et forkert sted. */
const ROLLE_START: Record<string, string> = {
  customer: '/portal', admin: '/admin', lager: '/lager', driver: '/chauffeur/rute',
}

export async function middleware(req: NextRequest) {
  const pathname = req.nextUrl.pathname

  // Sider man skal kunne nå UDEN at være logget ind. Glemt/nulstil adgangskode
  // hører med: uden dem sendte middlewaren brugeren tilbage til login, så
  // "Glemt adgangskode?" så ud til ikke at gøre noget — og nulstillingslinket i
  // mailen endte samme sted. Man kan pr. definition ikke logge ind for at komme
  // til den side der skal give én adgang igen.
  if (
    pathname === '/portal/login' ||
    pathname === '/portal/forgot-password' ||
    pathname === '/portal/reset-password' ||
    // "Gå ind som kunde": siden ER adgangen. Den indløser en engangsbillet udstedt af
    // en admin, så den kan ikke selv kræve at man allerede er logget ind.
    pathname === '/portal/som-kunde' ||
    pathname === '/admin/login' ||
    pathname === '/chauffeur/login' ||
    pathname === '/lager/login'
  ) return NextResponse.next()

  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET })

  // Admin-sider uden login → til ADMIN-login, ikke kundelogin. Linket fra BC's
  // debitorkort peger på /admin/..., og dér hjælper det ingen at lande på kundens
  // loginside med en adgangskode man ikke har.
  if (!token && pathname.startsWith('/admin')) {
    const url = new URL('/admin/login', req.url)
    url.searchParams.set('callbackUrl', pathname + req.nextUrl.search)
    return NextResponse.redirect(url)
  }

  // Chauffør-sider: kræver driver-rolle
  if (pathname.startsWith('/chauffeur')) {
    if (!token || token.role !== 'driver') {
      return NextResponse.redirect(new URL('/chauffeur/login', req.url))
    }
    return NextResponse.next()
  }

  // Lager-appen: kræver lager-rolle. En admin skal også kunne komme ind — ellers kan
  // kontoret ikke se hvad der sker på lageret uden at låne en håndterminal.
  if (pathname.startsWith('/lager')) {
    if (!token || (token.role !== 'lager' && token.role !== 'admin')) {
      return NextResponse.redirect(new URL('/lager/login', req.url))
    }
    return NextResponse.next()
  }

  // Ikke logget ind → send til login
  if (!token) {
    const loginUrl = new URL('/portal/login', req.url)
    loginUrl.searchParams.set('callbackUrl', pathname)
    return NextResponse.redirect(loginUrl)
  }

  // Admin-sider kræver admin-rolle. Send folk hjem til deres EGEN rolle — en pakker,
  // der fulgte et admin-link, blev før sendt ind i kundeportalen.
  if (pathname.startsWith('/admin') && token.role !== 'admin') {
    return NextResponse.redirect(new URL(ROLLE_START[String(token.role)] ?? '/portal', req.url))
  }

  // Kundeportalen er KUNDENS. En pakker, der endte her, fik kundens forside at se med
  // sit eget navn på: rolleskifteren sagde "Lager/pakker", mens skærmen viste "Ny
  // bestilling" og en tom ordreliste, fordi sessionen slet ikke har et kundenummer
  // (Claus 21-11). Det kræver ikke et rolleskifte — et gammelt ikon på hjemmeskærmen,
  // en push-besked (sw.js sender til /portal) eller et admin-link er nok.
  // Admin må gerne: kontoret ser kundens portal gennem kundevælgeren.
  if (pathname.startsWith('/portal') && token.role !== 'customer' && token.role !== 'admin') {
    return NextResponse.redirect(new URL(ROLLE_START[String(token.role)] ?? '/portal/login', req.url))
  }

  // Giv stien videre til server-komponenterne. Admin-layoutet bruger den til at
  // holde signage-begrænsede brugere inde på skærm-siderne — det tjek kræver et
  // databaseopslag og kan derfor ikke ligge her i Edge-middlewaren.
  const headers = new Headers(req.headers)
  headers.set('x-pathname', pathname)
  return NextResponse.next({ request: { headers } })
}

export const config = {
  matcher: ['/portal/:path*', '/admin/:path*', '/chauffeur/:path*', '/lager/:path*'],
}
