// Gemmer kundens kurv mellem besøg. Kun varenummer, antal og enhed — aldrig
// prisen, se src/lib/kurv.ts for hvorfor.

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { gemKurv, type KurvLinje } from '@/lib/kurv'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Ikke logget ind' }, { status: 401 })

  const customerId = (session.user as any)?.id as string
  if (!customerId) return NextResponse.json({ error: 'Ingen kunde' }, { status: 400 })

  const body = await req.json().catch(() => null)
  const raa = Array.isArray(body?.linjer) ? body.linjer : null
  if (!raa) return NextResponse.json({ error: 'linjer mangler' }, { status: 400 })

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
