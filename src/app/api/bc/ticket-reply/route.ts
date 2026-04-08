import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

// Webhook endpoint — BC kalder dette når en medarbejder svarer på en reklamation
// Autentificeres med BC_WEBHOOK_SECRET header
export async function POST(req: NextRequest) {
  const secret = req.headers.get('x-webhook-secret')
  if (secret !== process.env.BC_WEBHOOK_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { ticketId, body, senderName } = await req.json()
  if (!ticketId || !body?.trim()) {
    return NextResponse.json({ error: 'Mangler ticketId eller body' }, { status: 400 })
  }

  const ticket = await prisma.ticket.findUnique({ where: { id: ticketId } })
  if (!ticket) return NextResponse.json({ error: 'Ticket ikke fundet' }, { status: 404 })

  // Brug raw SQL — readByCustomer = 0 (false) markerer som ulæst for kunden
  const msgId = `bcmsg_${Date.now()}_${Math.random().toString(36).slice(2)}`
  const staffName = senderName ?? 'Venmark'
  const bodyText  = body.trim()
  await prisma.$executeRaw`
    INSERT INTO "TicketMessage" ("id","ticketId","sender","senderName","body","readByCustomer","createdAt")
    VALUES (${msgId}, ${ticketId}, 'STAFF', ${staffName}, ${bodyText}, false, NOW())
  `

  await prisma.ticket.update({
    where: { id: ticketId },
    data:  { status: 'IN_PROGRESS', updatedAt: new Date() },
  })

  return NextResponse.json({ ok: true })
}
