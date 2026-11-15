import { NextRequest, NextResponse } from 'next/server'
import { getToken } from 'next-auth/jwt'
import { hentKatalog } from '@/lib/lager/katalog'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// GET /api/lager/katalog[?since=ISO]
// Varekataloget til håndterminalens offline-lager. Uden ?since = hele kataloget.
// Med ?since = kun det der er ændret siden sidst, så en terminal på dårligt wifi i
// frostrummet ikke skal hente 4.000 varer igen for at få ét nyt varenavn.
export async function GET(req: NextRequest) {
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET })
  if (!token || (token.role !== 'lager' && token.role !== 'admin')) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  const since = (req.nextUrl.searchParams.get('since') ?? '').trim()
  const t0 = Date.now()
  const katalog = await hentKatalog(since)
  console.log(
    `[lager katalog] ${katalog.varer.length} varer${since ? ` siden ${since}` : ' (fuldt)'} ` +
    `på ${Date.now() - t0} ms${katalog.komplet ? '' : ' — AFKORTET'}`,
  )

  return NextResponse.json(katalog, {
    headers: { 'Cache-Control': 'no-store' },
  })
}
