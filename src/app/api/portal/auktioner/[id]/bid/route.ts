// POST /api/portal/auktioner/[id]/bid — læg bud (proxy-maks). Kun kreditgodkendte kunder
// (login-gaten sikrer isActive && !bcBlocked). Bud-motoren håndterer proxy/anti-snipe/lås.
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { placeBid } from '@/lib/auction'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session || (session.user as any).role !== 'customer') {
    return NextResponse.json({ ok: false, error: 'Log ind som kunde for at byde.' }, { status: 401 })
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
    return NextResponse.json({ ok: false, error: 'Ugyldig anmodning.' }, { status: 400 })
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ ok: false, error: 'Angiv et gyldigt bud.' }, { status: 400 })
  }

  // amount = budgiverens MAKS (autobud). Et almindeligt bud = maks lig det man taster.
  const r = await placeBid(params.id, { id: bidderId, name: bidderName }, amount)
  return NextResponse.json(r, { status: r.ok ? 200 : 400 })
}
