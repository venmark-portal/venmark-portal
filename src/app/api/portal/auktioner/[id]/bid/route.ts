// POST /api/portal/auktioner/[id]/bid — læg bud (proxy-maks). Kun kreditgodkendte kunder
// (login-gaten sikrer isActive && !bcBlocked). Bud-motoren håndterer proxy/anti-snipe/lås.
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { placeBid } from '@/lib/auction'
import { getT } from '@/lib/i18n/portal/server'
import type { TFunc } from '@/lib/i18n/portal/lang'
import { auktionDict } from '@/lib/i18n/portal/dict/auktion'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type AuktionKey = keyof typeof auktionDict.da

// Bud-motoren (lib/auction) returnerer danske fejltekster. De oversættes her ved udgangen,
// så motoren forbliver sprog-uafhængig. Ukendt tekst sendes uændret videre.
function oversaetBudFejl(fejl: string | undefined, t: TFunc<AuktionKey>): string | undefined {
  if (!fejl) return fejl
  const tal = fejl.match(/(\d+(?:[.,]\d+)?) kr\./)?.[1] ?? ''
  if (fejl === 'Ugyldigt bud.') return t('ugyldigtBud')
  if (fejl === 'Auktionen findes ikke.') return t('findesIkke')
  if (fejl === 'Auktionen er ikke i gang.') return t('ikkeIGang')
  if (fejl === 'Auktionen er udløbet.') return t('udloebet')
  if (fejl.startsWith('Første bud skal være mindst')) return t('foersteBud', { p: tal })
  if (fejl.startsWith('Du fører allerede.')) return t('allerede', { p: tal })
  if (fejl.startsWith('Buddet skal være mindst')) return t('mindst', { p: tal })
  return fejl
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const t = await getT(auktionDict)
  const session = await getServerSession(authOptions)
  if (!session || (session.user as any).role !== 'customer') {
    return NextResponse.json({ ok: false, error: t('logIndKunde') }, { status: 401 })
  }
  const bidderId = (session.user as any).id as string
  const bidderName = (
    (session.user as any).activeCustomerName || (session.user as any).name || 'Kunde'
  ) as string

  let amount: number
  try {
    const body = await req.json()
    amount = Number(body?.amount)
  } catch {
    return NextResponse.json({ ok: false, error: t('ugyldigAnmodning') }, { status: 400 })
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ ok: false, error: t('angivGyldigt') }, { status: 400 })
  }

  // amount = budgiverens MAKS (autobud). Et almindeligt bud = maks lig det man taster.
  const r = await placeBid(params.id, { id: bidderId, name: bidderName }, amount)
  const svar = r.ok ? r : { ...r, error: oversaetBudFejl(r.error, t) }
  return NextResponse.json(svar, { status: r.ok ? 200 : 400 })
}
