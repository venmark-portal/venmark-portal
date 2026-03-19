import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

function adminCheck(session: any) {
  return session?.user && (session.user as any).role === 'admin'
}

// POST: Admin sender svar til kunden
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!adminCheck(session)) return NextResponse.json({ error: 'Ikke autoriseret' }, { status: 401 })

  const { body } = await req.json()
  if (!body?.trim()) return NextResponse.json({ error: 'Tom besked' }, { status: 400 })

  const ticket = await prisma.ticket.findUnique({ where: { id: params.id } })
  if (!ticket) return NextResponse.json({ error: 'Ticket ikke fundet' }, { status: 404 })

  const msgId    = `adm_${Date.now()}_${Math.random().toString(36).slice(2)}`
  const staffName = (session!.user as any)?.name ?? 'Venmark'
  const bodyText  = body.trim()

  // Indsæt staff-besked — readByCustomer = 0 (ulæst for kunden)
  await prisma.$executeRaw`
    INSERT INTO "TicketMessage" ("id","ticketId","sender","senderName","body","readByCustomer","createdAt")
    VALUES (${msgId}, ${params.id}, 'STAFF', ${staffName}, ${bodyText}, 0, datetime('now'))
  `

  await prisma.ticket.update({
    where: { id: params.id },
    data:  { status: 'IN_PROGRESS', updatedAt: new Date() },
  })

  const msg = await prisma.ticketMessage.findUnique({ where: { id: msgId } })
  return NextResponse.json(msg, { status: 201 })
}

// PATCH: Skift status (åben/luk)
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!adminCheck(session)) return NextResponse.json({ error: 'Ikke autoriseret' }, { status: 401 })

  const { status } = await req.json()
  if (!['OPEN', 'IN_PROGRESS', 'CLOSED'].includes(status)) {
    return NextResponse.json({ error: 'Ugyldig status' }, { status: 400 })
  }

  await prisma.ticket.update({
    where: { id: params.id },
    data:  { status, updatedAt: new Date() },
  })

  return NextResponse.json({ ok: true })
}
