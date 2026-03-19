import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

// GET: hent ticket med beskeder (marker ulæste som læst)
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Ikke logget ind' }, { status: 401 })
  const customerId = (session.user as any)?.id as string

  const ticket = await prisma.ticket.findFirst({
    where:   { id: params.id, customerId },
    include: {
      messages: { orderBy: { createdAt: 'asc' } },
      images:   { orderBy: { createdAt: 'asc' } },
    },
  })
  if (!ticket) return NextResponse.json({ error: 'Ikke fundet' }, { status: 404 })

  // Marker ulæste beskeder som læst via raw SQL (klient ikke regenereret endnu)
  await prisma.$executeRaw`
    UPDATE "TicketMessage"
    SET "readByCustomer" = 1
    WHERE "ticketId" = ${params.id} AND "readByCustomer" = 0
  `

  return NextResponse.json(ticket)
}

// POST: tilføj svar fra kunde
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Ikke logget ind' }, { status: 401 })
  const customerId = (session.user as any)?.id as string
  const name       = (session.user as any)?.name as string

  const ticket = await prisma.ticket.findFirst({ where: { id: params.id, customerId } })
  if (!ticket) return NextResponse.json({ error: 'Ikke fundet' }, { status: 404 })

  const { body } = await req.json()
  if (!body?.trim()) return NextResponse.json({ error: 'Tom besked' }, { status: 400 })

  // Opret besked via raw SQL for at undgå manglende readByCustomer-type
  const msgId = `msg_${Date.now()}_${Math.random().toString(36).slice(2)}`
  await prisma.$executeRaw`
    INSERT INTO "TicketMessage" ("id","ticketId","sender","senderName","body","readByCustomer","createdAt")
    VALUES (${msgId}, ${params.id}, 'CUSTOMER', ${name}, ${body.trim()}, 1, datetime('now'))
  `

  // Genåbn ticket hvis lukket
  if (ticket.status === 'CLOSED') {
    await prisma.ticket.update({ where: { id: params.id }, data: { status: 'OPEN' } })
  }

  const msg = await prisma.ticketMessage.findUnique({ where: { id: msgId } })
  return NextResponse.json(msg, { status: 201 })
}
