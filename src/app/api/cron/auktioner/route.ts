// Afregnings-cron: markér udløbne LIVE-auktioner som ENDED, notificér vinderen i portalen,
// og ALARMÉR Venmark (mail til fisk + ulæst besked i admin) så de husker at kontakte vinderen.
// Køres hyppigt fra crontab (fx hvert minut). Idempotent (updateMany where status LIVE).
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { sendEmail } from '@/lib/email'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function koer() {
  const now = new Date()
  const expired = await prisma.auction.findMany({
    where: { status: 'LIVE', endsAt: { lte: now } },
    select: { id: true, title: true, leaderCustomerId: true, leaderName: true, currentPrice: true, priceMode: true },
  })

  let settled = 0
  for (const a of expired) {
    // Kun hvis den stadig er LIVE (undgå dobbelt-afregning ved parallelle kørsler).
    const upd = await prisma.auction.updateMany({
      where: { id: a.id, status: 'LIVE' }, data: { status: 'ENDED' },
    })
    if (upd.count === 0) continue
    settled++

    if (!a.leaderCustomerId) continue

    const unit = a.priceMode === 'PER_KG' ? ' kr/kg' : ' kr'
    const priceTxt = `${Number(a.currentPrice)}${unit}`

    // 1) Besked til VINDEREN (kunden)
    await prisma.message.create({
      data: {
        customerId: a.leaderCustomerId,
        sender: 'admin', senderName: 'Auktion',
        body: `🎉 Du vandt auktionen "${a.title}" til ${priceTxt}. Venmark kontakter dig for levering (ASAP).`,
        readByAdmin: true, readByCustomer: false,
        expiresAt: new Date(Date.now() + 30 * 24 * 3600 * 1000),
      },
    })

    // Vinderens stamdata til alarm
    const winner = await prisma.customer.findUnique({
      where: { id: a.leaderCustomerId },
      select: { name: true, bcCustomerNumber: true, phone: true, email: true },
    })
    const winnerLabel = a.leaderName || winner?.name || 'Kunde'

    // 2) SYNLIGT I ADMIN: en ulæst besked i kundens tråd (sender='customer' → tælles i admin-ulæst,
    //    så Venmark får et rødt tal og bliver mindet om at følge op). readByCustomer=true så det
    //    ikke støjer for kunden (vinderen har allerede fået sin egen besked ovenfor).
    await prisma.message.create({
      data: {
        customerId: a.leaderCustomerId,
        sender: 'customer', senderName: 'Auktion',
        body: `🏆 Auktion afgjort: "${a.title}" vundet til ${priceTxt}. Venmark følger op med levering.`,
        readByAdmin: false, readByCustomer: true,
        expiresAt: new Date(Date.now() + 30 * 24 * 3600 * 1000),
      },
    })

    // 3) MAIL TIL VENMARK (fisk@venmark.dk)
    try {
      await sendEmail({
        to: process.env.NOTIFICATION_EMAIL || 'fisk@venmark.dk',
        subject: `🏆 Auktion vundet — ${a.title}`,
        text:
          `Auktionen "${a.title}" er afsluttet med en vinder.\n\n` +
          `Vinder: ${winnerLabel}${winner?.bcCustomerNumber ? ` (#${winner.bcCustomerNumber})` : ''}\n` +
          (winner?.phone ? `Telefon: ${winner.phone}\n` : '') +
          (winner?.email ? `Email: ${winner.email}\n` : '') +
          `Vinderpris: ${priceTxt}\n\n` +
          `Kontakt kunden for levering (ASAP).`,
      })
    } catch (e) {
      console.error('Auktion vinder-mail fejlede:', e)
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
