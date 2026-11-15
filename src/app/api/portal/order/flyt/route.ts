// Flyt leveringsdagen på en åben ordre. Body: { ordrenr, nyDato: 'YYYY-MM-DD', udfoer: boolean }.
// udfoer=false → kun tjek (hvad sker der, kan alt leveres); true → flyt. Se src/lib/flytLevering.ts.

import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getActiveCustomerNo, getParentCustomerNo, isCustomerAllowed } from '@/lib/activeCustomer'
import { flytLeveringsdag, flytMuligheder } from '@/lib/flytLevering'

export const maxDuration = 60

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  const u = session?.user as any
  if (!u?.id || u.role !== 'customer') return NextResponse.json({ ok: false, fejl: 'Ikke logget ind.' }, { status: 401 })

  const parentNo = getParentCustomerNo(session)
  const customerNo = getActiveCustomerNo(session)
  if (!(await isCustomerAllowed(parentNo, customerNo))) return NextResponse.json({ ok: false, fejl: 'Ingen adgang.' }, { status: 403 })

  const { ordrenr, nyDato, udfoer } = await req.json().catch(() => ({}))
  if (!ordrenr || !nyDato) return NextResponse.json({ ok: false, fejl: 'Ordre og dato mangler.' }, { status: 400 })

  const res = await flytLeveringsdag(
    { customerId: u.id, customerNo, navn: u.name ?? customerNo, somAdmin: u.impersonatedBy ? String(u.impersonatedBy) : null },
    String(ordrenr), String(nyDato), udfoer === true,
  )
  if (res.flyttet) revalidatePath('/portal/ordrer')
  return NextResponse.json(res)
}

/** GET ?ordrenr=X → nuværende leveringsdag og de dage ordren kan flyttes til (eller fejl). */
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  const u = session?.user as any
  if (!u?.id || u.role !== 'customer') return NextResponse.json({ ok: false, fejl: 'Ikke logget ind.' }, { status: 401 })
  const parentNo = getParentCustomerNo(session)
  const customerNo = getActiveCustomerNo(session)
  if (!(await isCustomerAllowed(parentNo, customerNo))) return NextResponse.json({ ok: false, fejl: 'Ingen adgang.' }, { status: 403 })

  const ordrenr = req.nextUrl.searchParams.get('ordrenr') ?? ''
  if (!ordrenr) return NextResponse.json({ ok: false, fejl: 'Ordre mangler.' }, { status: 400 })
  const m = await flytMuligheder(customerNo, ordrenr).catch(() => ({ ok: false, fejl: 'BC svarede ikke.' }))
  if ('ok' in m) return NextResponse.json(m)
  return NextResponse.json({ ok: true, ordre: m.o.number, fra: m.fra, dage: m.dage.slice(0, 10) })
}
