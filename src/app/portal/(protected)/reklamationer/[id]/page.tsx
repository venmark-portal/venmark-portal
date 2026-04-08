import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { redirect } from 'next/navigation'
import TicketThread from './TicketThread'

export const dynamic = 'force-dynamic'

export default async function TicketPage({ params }: { params: { id: string } }) {
  const session    = await getServerSession(authOptions)
  const customerId = (session?.user as any)?.id as string

  const ticket = await prisma.ticket.findFirst({
    where:   { id: params.id, customerId },
    include: {
      messages: { orderBy: { createdAt: 'asc' } },
      images:   { orderBy: { createdAt: 'asc' } },
    },
  })

  if (!ticket) redirect('/portal/reklamationer')

  // Marker ulæste som læst via raw SQL (klient ikke regenereret endnu)
  await prisma.$executeRaw`
    UPDATE "TicketMessage"
    SET "readByCustomer" = true
    WHERE "ticketId" = ${params.id} AND "readByCustomer" = false
  `

  return (
    <div className="space-y-4">
      <div>
        <a href="/portal/reklamationer" className="text-sm text-blue-600 hover:underline">← Alle reklamationer</a>
        <h1 className="text-xl font-bold text-gray-900 mt-1">{ticket.subject}</h1>
        {ticket.orderRef && <p className="text-xs text-gray-400 mt-0.5">Ordre: {ticket.orderRef}</p>}
      </div>
      <TicketThread ticket={ticket as any} />
    </div>
  )
}
