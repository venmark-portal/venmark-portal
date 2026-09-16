// Admin: GET liste + POST opret auktion. Kun role === 'admin'.
// Billeder (op til 3) sendes som base64/data-URL i payloaden (upload/kamera).
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function adminOnly(session: any) {
  return session && (session.user as any)?.role === 'admin'
}

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!adminOnly(session)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const rows = await prisma.auction.findMany({
    orderBy: [{ endsAt: 'asc' }],
    include: { _count: { select: { bids: true, images: true } } },
  })
  return NextResponse.json({
    auctions: rows.map((a) => ({
      id: a.id, title: a.title, status: a.status, priceMode: a.priceMode,
      minPrice: Number(a.minPrice), currentPrice: Number(a.currentPrice),
      leaderName: a.leaderName, bidCount: a.bidCount,
      startsAt: a.startsAt, endsAt: a.endsAt, images: a._count.images,
    })),
  })
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!adminOnly(session)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const adminId = (session!.user as any).id as string

  let b: any
  try { b = await req.json() } catch { return NextResponse.json({ error: 'bad_request' }, { status: 400 }) }

  const title = String(b?.title ?? '').trim()
  if (!title) return NextResponse.json({ error: 'Titel mangler.' }, { status: 400 })

  const endsAt = new Date(b?.endsAt)
  if (isNaN(endsAt.getTime()) || endsAt.getTime() <= Date.now()) {
    return NextResponse.json({ error: 'Ugyldig udløbstid (skal være i fremtiden).' }, { status: 400 })
  }

  const priceMode = b?.priceMode === 'PER_KG' ? 'PER_KG' : 'TOTAL'
  const minPrice = Math.max(0, Number(b?.minPrice) || 0)
  const images: any[] = Array.isArray(b?.images) ? b.images.slice(0, 3) : []

  const a = await prisma.auction.create({
    data: {
      title,
      description: String(b?.description ?? ''),
      itemNo: b?.itemNo ? String(b.itemNo) : null,
      lotText: b?.lotText ? String(b.lotText) : null,
      priceMode,
      minPrice,
      minIncrement: 1,
      startsAt: new Date(),
      endsAt,
      status: b?.startNow ? 'LIVE' : 'DRAFT',
      createdBy: adminId,
      images: {
        create: images
          .filter((im) => im?.data)
          .map((im, i) => ({ data: String(im.data), mimeType: String(im.mimeType || 'image/jpeg'), sort: i })),
      },
    },
  })
  return NextResponse.json({ ok: true, id: a.id })
}
