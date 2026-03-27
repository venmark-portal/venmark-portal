import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { updateStandingOrderLine } from '@/lib/businesscentral'

/**
 * PATCH /api/portal/standing-orders
 * Body: { id: string (GUID), qtyMonday?, qtyTuesday?, qtyWednesday?, qtyThursday?, qtyFriday?, standingNote? }
 * Opdaterer én fast ordrelinje i BC (Portal Standing Order Line via page 50166).
 */
export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Ikke logget ind' }, { status: 401 })

  const body = await req.json()
  const { id, ...patch } = body

  if (!id) return NextResponse.json({ error: 'id mangler' }, { status: 400 })

  // Tillad kun kendte felter (sikkerhed)
  const allowed = ['qtyMonday', 'qtyTuesday', 'qtyWednesday', 'qtyThursday', 'qtyFriday', 'unitOfMeasureCode', 'sortOrder', 'standingNote']
  const safePatch = Object.fromEntries(
    Object.entries(patch).filter(([k]) => allowed.includes(k))
  )

  if (Object.keys(safePatch).length === 0) {
    return NextResponse.json({ error: 'Ingen gyldige felter at opdatere' }, { status: 400 })
  }

  const ok = await updateStandingOrderLine(id, safePatch)
  if (!ok) return NextResponse.json({ error: 'BC opdatering fejlede' }, { status: 502 })

  return NextResponse.json({ ok: true })
}
