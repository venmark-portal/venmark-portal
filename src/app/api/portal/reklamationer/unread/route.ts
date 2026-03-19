import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ unreadMessages: 0, openTickets: 0 })
  const customerId = (session.user as any)?.id as string

  // Brug $queryRaw — readByCustomer-kolonnen eksisterer i DB men klienten er ikke regenereret endnu
  const rows = await prisma.$queryRaw<{ count: bigint }[]>`
    SELECT COUNT(*) as count FROM "TicketMessage"
    WHERE "readByCustomer" = 0
    AND "ticketId" IN (SELECT "id" FROM "Ticket" WHERE "customerId" = ${customerId})
  `
  const unreadMessages = Number(rows[0]?.count ?? 0)

  const openTickets = await prisma.ticket.count({
    where: { customerId, status: { not: 'CLOSED' } },
  })

  return NextResponse.json({ unreadMessages, openTickets })
}
