// Gemmer kundens kurv mellem besøg. Kun varenummer, antal og enhed — aldrig
// prisen, se src/lib/kurv.ts for hvorfor.

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { gemKurv, type KurvLinje } from '@/lib/kurv'
import { getT } from '@/lib/i18n/portal/server'
import { bestilApiDict } from '@/lib/i18n/portal/dict/bestil-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  const t = await getT(bestilApiDict)
  if (!session) return NextResponse.json({ error: t('ikkeLoggetInd') }, { status: 401 })

  const customerId = (session.user as any)?.id as string
  if (!customerId) return NextResponse.json({ error: t('ingenKunde') }, { status: 400 })

  const body = await req.json().catch(() => null)
  const raa = Array.isArray(body?.linjer) ? body.linjer : null
  if (!raa) return NextResponse.json({ error: t('linjerMangler') }, { status: 400 })

  const linjer: KurvLinje[] = raa
    .filter((l: any) => l && typeof l.itemNo === 'string')
    .map((l: any) => ({
      itemNo:   String(l.itemNo),
      quantity: Number(l.quantity ?? 0),
      uom:      String(l.uom ?? ''),
    }))

  try {
    await gemKurv(customerId, linjer)
    return NextResponse.json({ ok: true, antal: linjer.length })
  } catch (err) {
    // At gemme kurven må ALDRIG vælte bestillingen. Fejler det, mister kunden
    // kun muligheden for at komme tilbage til den — ikke selve bestillingen.
    console.error('[kurv] kunne ikke gemmes:', err instanceof Error ? err.message : err)
    return NextResponse.json({ ok: false }, { status: 200 })
  }
}
