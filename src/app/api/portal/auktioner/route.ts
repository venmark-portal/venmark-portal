// GET /api/portal/auktioner — liste over LIVE auktioner (kunde-liste + forside-resumé).
// Kun synlig for indloggede kunder. Budgivernavne eksponeres ikke.
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { publicState } from '@/lib/auction'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session || (session.user as any).role !== 'customer') {
    return NextResponse.json({ auctions: [] }, { status: 401 })
  }
  const viewerId = (session.user as any).id as string

  const rows = await prisma.auction.findMany({
    where: { status: 'LIVE', startsAt: { lte: new Date() } },
    orderBy: { endsAt: 'asc' },
    include: { images: { orderBy: { sort: 'asc' }, take: 1, select: { id: true } } },
  })

  const auctions = rows.map((a) => {
    const s = publicState(a, viewerId)
    return {
      id: s.id, status: s.status, currentPrice: s.currentPrice, bidCount: s.bidCount,
      minNext: s.minNext, endsAt: s.endsAt, ended: s.ended, youLead: s.youLead,
      title: a.title, priceMode: a.priceMode, lotText: a.lotText,
      thumbId: a.images[0]?.id ?? null,
    }
  })
  return NextResponse.json({ auctions })
}
