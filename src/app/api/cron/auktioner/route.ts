// Afregnings-cron: markér udløbne LIVE-auktioner som ENDED og notificér vinderen i portalen.
// Køres hyppigt fra crontab (fx hvert minut). Idempotent (updateMany where status LIVE).
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function koer() {
  const now = new Date()
  const expired = await prisma.auction.findMany({
    where: { status: 'LIVE', endsAt: { lte: now } },
    select: { id: true, title: true, leaderCustomerId: true, currentPrice: true, priceMode: true },
  })

  let settled = 0
  for (const a of expired) {
    // Kun hvis den stadig er LIVE (undgå dobbelt-afregning ved parallelle kørsler).
    const upd = await prisma.auction.updateMany({
      where: { id: a.id, status: 'LIVE' }, data: { status: 'ENDED' },
    })
    if (upd.count === 0) continue
    settled++

    if (a.leaderCustomerId) {
      const unit = a.priceMode === 'PER_KG' ? ' kr/kg' : ' kr'
      await prisma.message.create({
        data: {
          customerId: a.leaderCustomerId,
          sender: 'admin', senderName: 'Auktion',
          body: `🎉 Du vandt auktionen "${a.title}" til ${Number(a.currentPrice)}${unit}. Venmark kontakter dig for levering (ASAP).`,
          readByAdmin: true, readByCustomer: false,
          expiresAt: new Date(Date.now() + 30 * 24 * 3600 * 1000),
        },
      })
    }
  }
  return NextResponse.json({ ok: true, checked: expired.length, settled })
}

export async function POST(req: NextRequest) {
  if (req.headers.get('x-cron-secret') !== process.env.CRON_SECRET) {
    return new NextResponse('Unauthorized', { status: 401 })
  }
  return koer()
}
