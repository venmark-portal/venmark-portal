import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import Link from 'next/link'
import { MessageSquareWarning, ChevronRight, Clock } from 'lucide-react'
import { getPortalLang } from '@/lib/i18n/portal/server'
import { makeT, localeOf } from '@/lib/i18n/portal/lang'
import { reklamationDict } from '@/lib/i18n/portal/dict/reklamation'

export const dynamic = 'force-dynamic'

const STATUS_LABELS: Record<string, { label: 'statusOpen' | 'statusIgang' | 'statusLukket'; color: string }> = {
  OPEN:        { label: 'statusOpen',   color: 'bg-yellow-100 text-yellow-800' },
  IN_PROGRESS: { label: 'statusIgang',  color: 'bg-blue-100 text-blue-800' },
  CLOSED:      { label: 'statusLukket', color: 'bg-gray-100 text-gray-600'   },
}

export default async function ReklamationerPage() {
  const session    = await getServerSession(authOptions)
  const customerId = (session?.user as any)?.id as string
  const lang       = await getPortalLang()
  const t          = makeT(reklamationDict, lang)

  const tickets = await prisma.ticket.findMany({
    where:   { customerId },
    orderBy: { updatedAt: 'desc' },
    include: {
      messages: { select: { id: true, sender: true } }, // henter alle, filtrerer nedenfor
      _count:   { select: { messages: true } },
    },
  })

  // Ulæste = staff-beskeder (readByCustomer = 0 i DB) — tæl via raw da klienten ikke er regenereret endnu
  const unreadRows = await prisma.$queryRaw<{ ticketId: string; count: bigint }[]>`
    SELECT "ticketId", COUNT(*) as count FROM "TicketMessage"
    WHERE "readByCustomer" = false
    AND "ticketId" IN (SELECT "id" FROM "Ticket" WHERE "customerId" = ${customerId})
    GROUP BY "ticketId"
  `
  const unreadMap = new Map(unreadRows.map(r => [r.ticketId, Number(r.count)]))

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t('oversigtTitel')}</h1>
          <p className="mt-1 text-sm text-gray-500">{t('oversigtIntro')}</p>
        </div>
        <Link
          href="/portal/reklamation"
          className="rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700"
        >
          {t('ny')}
        </Link>
      </div>

      {tickets.length === 0 ? (
        <div className="rounded-xl bg-white p-10 text-center ring-1 ring-gray-200">
          <MessageSquareWarning size={36} className="mx-auto text-gray-300 mb-3" />
          <p className="text-sm text-gray-500">{t('ingen')}</p>
          <Link href="/portal/reklamation" className="mt-3 inline-block text-sm text-blue-600 hover:underline">
            {t('opretFoerste')}
          </Link>
        </div>
      ) : (
        <div className="divide-y divide-gray-100 overflow-hidden rounded-xl bg-white ring-1 ring-gray-200">
          {tickets.map(ticket => {
            const unread = unreadMap.get(ticket.id) ?? 0
            const st     = STATUS_LABELS[ticket.status] ?? STATUS_LABELS.OPEN
            return (
              <Link
                key={ticket.id}
                href={`/portal/reklamationer/${ticket.id}`}
                className="flex items-center gap-4 px-4 py-3.5 hover:bg-gray-50 transition"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium text-gray-900">{ticket.subject}</span>
                    {unread > 0 && (
                      <span className="shrink-0 inline-flex items-center justify-center h-5 min-w-[20px] rounded-full bg-blue-600 text-[11px] font-bold text-white px-1.5">
                        {unread}
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 flex items-center gap-2 text-xs text-gray-400">
                    <Clock size={11} />
                    {ticket.updatedAt.toLocaleDateString(localeOf(lang), { day: 'numeric', month: 'short', year: 'numeric' })}
                    · {ticket._count.messages} {ticket._count.messages === 1 ? t('besked') : t('beskeder')}
                    {ticket.orderRef && <span>· {t('ordre', { nr: ticket.orderRef })}</span>}
                  </div>
                </div>
                <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-medium ${st.color}`}>
                  {t(st.label)}
                </span>
                <ChevronRight size={16} className="shrink-0 text-gray-400" />
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
