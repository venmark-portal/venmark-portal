// GET /api/portal/auktioner/[id] — detaljer + tilstand til polling (kunde-vendt).
// Budgivernavne maskeres: kunden ser "Dit bud" på egne, ellers kun beløb.
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { publicState } from '@/lib/auction'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session || (session.user as any).role !== 'customer') {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const viewerId = (session.user as any).id as string

  const a = await prisma.auction.findUnique({
    where: { id: params.id },
    include: {
      images: { orderBy: { sort: 'asc' }, select: { id: true } },
      bids: { orderBy: { createdAt: 'desc' }, take: 25, select: { amount: true, createdAt: true, customerId: true } },
    },
  })
  // Kunder ser kun LIVE/ENDED — ikke kladder eller aflyste.
  if (!a || a.status === 'DRAFT' || a.status === 'CANCELLED') {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }

  const s = publicState(a, viewerId)
  return NextResponse.json({
    id: s.id, status: s.status, currentPrice: s.currentPrice, bidCount: s.bidCount,
    minNext: s.minNext, endsAt: s.endsAt, ended: s.ended, youLead: s.youLead,
    title: a.title, description: a.description, priceMode: a.priceMode,
    lotText: a.lotText, itemNo: a.itemNo,
    minIncrement: Number(a.minIncrement),
    imageIds: a.images.map((i) => i.id),
    // Maskeret bud-historik: eget bud markeres, andres vises kun som beløb.
    bids: a.bids.map((b) => ({ amount: Number(b.amount), at: b.createdAt, mine: b.customerId === viewerId })),
  })
}
