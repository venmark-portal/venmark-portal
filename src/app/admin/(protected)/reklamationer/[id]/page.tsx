import { prisma } from '@/lib/prisma'
import { redirect } from 'next/navigation'
import AdminTicketThread from './AdminTicketThread'
import { User, Package } from 'lucide-react'

export const dynamic = 'force-dynamic'

export default async function AdminTicketPage({ params }: { params: { id: string } }) {
  const ticket = await prisma.ticket.findUnique({
    where:   { id: params.id },
    include: {
      customer: { select: { name: true, bcCustomerNumber: true, email: true } },
      messages: { orderBy: { createdAt: 'asc' } },
      images:   { orderBy: { createdAt: 'asc' } },
    },
  })

  if (!ticket) redirect('/admin/reklamationer')

  const messages = ticket.messages.map(m => ({
    id:         m.id,
    sender:     m.sender,
    senderName: m.senderName,
    body:       m.body,
    createdAt:  m.createdAt.toISOString(),
  }))

  return (
    <div className="space-y-6 max-w-3xl">

      {/* Tilbage + titel */}
      <div>
        <a href="/admin/reklamationer" className="text-sm text-blue-600 hover:underline">← Alle reklamationer</a>
        <h1 className="mt-1 text-xl font-bold text-gray-900">{ticket.subject}</h1>
      </div>

      {/* Kundeinfo */}
      <div className="flex flex-wrap gap-4 text-sm">
        <div className="flex items-center gap-2 rounded-lg bg-gray-100 px-3 py-2 text-gray-700">
          <User size={14} />
          <span className="font-medium">{ticket.customer.name}</span>
          <span className="text-gray-400">#{ticket.customer.bcCustomerNumber}</span>
        </div>
        {ticket.orderRef && (
          <div className="flex items-center gap-2 rounded-lg bg-gray-100 px-3 py-2 text-gray-700">
            <Package size={14} />
            <span>Ordre: <span className="font-medium">{ticket.orderRef}</span></span>
          </div>
        )}
        <div className="flex items-center gap-2 rounded-lg bg-gray-100 px-3 py-2 text-gray-500">
          {ticket.createdAt.toLocaleDateString('da-DK', { day: 'numeric', month: 'long', year: 'numeric' })}
        </div>
      </div>

      {/* Originale reklamationstekst */}
      <div className="rounded-xl border border-red-200 bg-red-50 p-5">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-red-500">Kundens beskrivelse</p>
        <p className="text-sm leading-relaxed text-gray-800 whitespace-pre-wrap">{ticket.body}</p>
      </div>

      {/* Billeder */}
      {ticket.images.length > 0 && (
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Vedhæftede billeder</p>
          <div className="flex flex-wrap gap-3">
            {ticket.images.map(img => (
              <a key={img.id} href={`data:${img.mimeType};base64,${img.data}`} target="_blank" rel="noopener noreferrer">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`data:${img.mimeType};base64,${img.data}`}
                  alt={img.fileName}
                  className="h-28 w-28 rounded-lg object-cover border border-gray-200 hover:opacity-90 transition"
                />
              </a>
            ))}
          </div>
        </div>
      )}

      {/* Chat-tråd + svar */}
      <div className="rounded-xl border border-gray-200 bg-gray-50 p-5">
        <p className="mb-4 text-xs font-semibold uppercase tracking-wide text-gray-500">Korrespondance</p>
        <AdminTicketThread
          ticketId={ticket.id}
          initialMessages={messages}
          status={ticket.status}
        />
      </div>
    </div>
  )
}
