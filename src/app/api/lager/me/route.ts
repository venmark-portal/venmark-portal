import { NextRequest, NextResponse } from 'next/server'
import { getToken } from 'next-auth/jwt'
import { hentLokationer } from '@/lib/lager/bc'
import { hentHylder } from '@/lib/lager/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// GET: hvem er jeg, hvad må jeg, hvilke lokationer og hylder kan jeg vælge.
// Ét kald ved opstart, så appen kan arbejde videre offline bagefter.
export async function GET(req: NextRequest) {
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET })
  if (!token || (token.role !== 'lager' && token.role !== 'admin')) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  const lokation = String((token as any).lagerLocation ?? '')
  const [alle, hylder] = await Promise.all([hentLokationer(), hentHylder('')])

  // BC har ~50 lokationer, men de færreste er vores eget lager — resten er auktioner,
  // lønhuggere og frysehuse. Vores egne skal stå øverst, så ingen scroller forbi dem:
  //   1. brugerens egen lokation
  //   2. lokationer vi har oprettet hylder på (dem tælles der faktisk på)
  //   3. de kendte Venmark-lokationer
  //   4. resten, alfabetisk
  const medHylder = new Set(hylder.map(h => h.locationCode))
  const kendte = ['VENMARK', 'PRODUCTION', 'XVEN-KØB']
  const vaegt = (kode: string) => {
    if (kode === lokation) return 0
    if (medHylder.has(kode)) return 1
    if (kendte.includes(kode)) return 2
    // Kødbyen og andre Venmark-koder hedder ikke altid det samme — fang dem på navnet.
    if (kode.includes('VENM') || kode.includes('KBH')) return 3
    return 9
  }
  const lokationer = [...alle].sort(
    (a, b) => vaegt(a.kode) - vaegt(b.kode) || a.kode.localeCompare(b.kode, 'da'),
  ).map(l => ({ ...l, foretrukken: vaegt(l.kode) <= 3 }))

  return NextResponse.json({
    id: token.sub ?? '',
    navn: token.name ?? '',
    initialer: (token as any).lagerInitials ?? '',
    rolle: token.role,
    lokation,
    maaTaelle: token.role === 'admin' ? true : !!(token as any).lagerCanCount,
    maaPakke: token.role === 'admin' ? true : !!(token as any).lagerCanPack,
    lokationer,
    hylder,
  })
}
