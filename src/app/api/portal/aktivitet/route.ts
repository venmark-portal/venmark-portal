import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { normaliserSti, registrerAktivitet } from '@/lib/aktivitet'

// Modtager sidevisninger og aktivitets-pulser fra AktivitetsMaaler (se src/lib/aktivitet.ts).
// Svarer altid 204 — logningen må aldrig give kunden en fejl.
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    const u = session?.user as any
    if (!u || u.role !== 'customer' || u.impersonatedBy) return new NextResponse(null, { status: 204 })

    const body = await req.json().catch(() => ({}))
    const type = body?.type === 'puls' ? 'puls' : 'side'
    const sti  = typeof body?.sti === 'string' ? normaliserSti(body.sti) : null
    if (type === 'side' && !sti) return new NextResponse(null, { status: 204 })

    const kundeNr = String(u.activeCustomerNumber || u.bcCustomerNumber || '')
    const email   = String(u.email || '').toLowerCase()
    if (!kundeNr || !email) return new NextResponse(null, { status: 204 })

    await registrerAktivitet({
      type,
      sti,
      kundeNr,
      kundeNavn:   String(u.activeCustomerName || u.name || ''),
      brugerEmail: email,
      brugerNavn:  String(u.name || ''),
      erKontakt:   Boolean(u.isContact),
      enhed:       body?.mobil ? 'mobil' : 'desktop',
    })
  } catch (e: any) {
    console.error('[aktivitet] kunne ikke logge:', e?.message ?? e)
  }
  return new NextResponse(null, { status: 204 })
}
