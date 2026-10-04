import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import Link from 'next/link'
import { ShoppingCart, RefreshCw, Package, ChevronRight, Clock, MessageSquareWarning, MessageSquare } from 'lucide-react'
import { getPortalShipmentMethods, getCustomerShipmentMethodCode, getCustomerPortalShipmentMethods, getPortalCalendarDays, type BCCalendarDay } from '@/lib/businesscentral'
import { getDeliveryDatesForMethod, getDeadlineForMethodDelivery, getDeadlineForDelivery, addBusinessDays } from '@/lib/dateUtils'
import AuktionForsideWidget from '@/components/portal/AuktionForsideWidget'

export default async function PortalDashboard() {
  const session    = await getServerSession(authOptions)
  const userId     = (session?.user as any)?.id as string
  const customerNo = (session?.user as any)?.bcCustomerNumber as string ?? ''

  // Hent seneste ordrer
  const recentOrders = await prisma.order.findMany({
    where:   { customerId: userId },
    orderBy: { createdAt: 'desc' },
    take:    5,
    include: { lines: true },
  })

  // Nyeste beskeder fra Venmark
  const newestMessages = await prisma.$queryRaw<{
    id: string; sender: string; senderName: string | null; body: string; readByCustomer: boolean; createdAt: Date
  }[]>`
    SELECT id, sender, "senderName", body, "readByCustomer", "createdAt"
    FROM "Message"
    WHERE "customerId" = ${userId} AND "expiresAt" > NOW()
    ORDER BY "createdAt" DESC LIMIT 3
  `.catch(() => [] as any[])

  const unreadMessages = newestMessages.filter((m: any) => !m.readByCustomer && m.sender === 'admin').length

  // Ulæste ticket-beskeder
  const unreadRows = await prisma.$queryRaw<[{ cnt: bigint }]>`
    SELECT COUNT(*) as cnt
    FROM "TicketMessage" tm
    JOIN "Ticket" t ON t.id = tm."ticketId"
    WHERE t."customerId" = ${userId}
      AND tm."readByCustomer" = false
  `
  const unreadTicketMessages = Number(unreadRows[0]?.cnt ?? 0)

  const openRows = await prisma.$queryRaw<[{ cnt: bigint }]>`
    SELECT COUNT(*) as cnt FROM "Ticket"
    WHERE "customerId" = ${userId} AND status != 'CLOSED'
  `
  const openTickets = Number(openRows[0]?.cnt ?? 0)

  // Lokal YYYY-MM-DD (IKKE toISOString — den skifter til UTC og rykker datoen en dag tilbage)
  const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  const om90 = new Date(); om90.setDate(om90.getDate() + 90)

  // Hent kundens leveringsmetode for korrekt cutoff-tid
  const [portalShipmentMethods, customerShipMethodCode, customerAllowedCodes, calendarDays] = await Promise.all([
    getPortalShipmentMethods().catch(() => []),
    getCustomerShipmentMethodCode(customerNo).catch(() => ''),
    // Eksplicitte typer på fallbacks: med fire elementer falder Promise.all tilbage til sin
    // array-overload, og [] bliver ellers udledt som never[].
    getCustomerPortalShipmentMethods(customerNo).catch(() => [] as string[]),
    getPortalCalendarDays(ymd(new Date()), ymd(om90)).catch(() => [] as BCCalendarDay[]),
  ])
  const allowedMethods = customerAllowedCodes.length > 0
    ? portalShipmentMethods.filter(m => customerAllowedCodes.includes(m.code))
    : portalShipmentMethods.filter(m => m.code === customerShipMethodCode)
  const customerMethod = allowedMethods[0] ?? portalShipmentMethods.find(m => m.code === customerShipMethodCode)

  // Næste leveringsdato og deadline.
  //
  // Forsiden havde sin egen regel ("+1 dag, fredag +3") og sin egen deadline ("i dag kl.
  // cutoffTime"). Den kunne derfor sige noget andet end den side man rent faktisk bestiller
  // på — og den vidste ikke om dagens frist var passeret. Nu bruges SAMME to funktioner som
  // bestillingssiden, så de to sider ikke kan komme på tværs af hinanden.
  const today = new Date()
  const nextDelivery = customerMethod
    ? getDeliveryDatesForMethod(customerMethod, calendarDays, today, 1)[0]
    : addBusinessDays(today, 1)
  const deadline = nextDelivery
    ? (customerMethod
        ? getDeadlineForMethodDelivery(nextDelivery, customerMethod, calendarDays)
        : getDeadlineForDelivery(nextDelivery))
    : null

  // "i dag" / "i morgen" / ugedagen — en deadline der er passeret ruller videre til næste
  // afsendelsesdag, og så er "Deadline i dag" forkert.
  const dagOrd = (d: Date): string => {
    const dage = Math.round(
      (new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() -
       new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()) / 86400000)
    if (dage === 0) return 'i dag'
    if (dage === 1) return 'i morgen'
    return d.toLocaleDateString('da-DK', { weekday: 'long' })
  }
  const klokken = (d: Date) =>
    `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`

  const statusLabel: Record<string, { label: string; color: string }> = {
    DRAFT:      { label: 'Kladde',       color: 'text-gray-500 bg-gray-100' },
    SUBMITTED:  { label: 'Afventer',     color: 'text-yellow-700 bg-yellow-100' },
    APPROVED:   { label: 'Godkendt',     color: 'text-blue-700 bg-blue-100' },
    SENT_TO_BC: { label: 'Sendt',        color: 'text-blue-700 bg-blue-100' },
    CONFIRMED:  { label: 'Bekræftet',    color: 'text-green-700 bg-green-100' },
    REJECTED:   { label: 'Afvist',       color: 'text-red-700 bg-red-100' },
  }

  return (
    <div className="space-y-6">
      {/* Velkomst */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">
          Hej, {session?.user?.name?.split(' ')[0]} 👋
        </h1>
        {nextDelivery && deadline && (
          <p className="mt-1 text-sm text-gray-500">
            Bestil {dagOrd(deadline)} inden kl. {klokken(deadline)} for levering {dagOrd(nextDelivery)}
          </p>
        )}
      </div>

      {/* Deadline-banner */}
      {nextDelivery && deadline && (
        <div className="flex items-center gap-3 rounded-xl bg-blue-50 px-4 py-3 text-sm text-blue-800">
          <Clock size={18} className="shrink-0" />
          <span>
            <strong>Deadline {dagOrd(deadline)} kl. {klokken(deadline)}</strong> — Næste levering:{' '}
            {nextDelivery.toLocaleDateString('da-DK', { weekday: 'long', day: 'numeric', month: 'long' })}
          </span>
        </div>
      )}

      {/* Hurtige handlinger */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Link
          href="/portal/bestil"
          className="flex items-center gap-4 rounded-xl bg-blue-600 px-5 py-4 text-white shadow-sm hover:bg-blue-700"
        >
          <ShoppingCart size={24} />
          <div>
            <div className="font-semibold">Ny bestilling</div>
            <div className="text-xs text-blue-200">Vælg varer og indsend</div>
          </div>
          <ChevronRight size={18} className="ml-auto" />
        </Link>

        <Link
          href="/portal/fast"
          className="flex items-center gap-4 rounded-xl bg-white px-5 py-4 shadow-sm ring-1 ring-gray-200 hover:bg-gray-50"
        >
          <RefreshCw size={24} className="text-blue-600" />
          <div>
            <div className="font-semibold text-gray-900">Faste ordrer</div>
            <div className="text-xs text-gray-500">Se og ret ugeskabelon</div>
          </div>
          <ChevronRight size={18} className="ml-auto text-gray-400" />
        </Link>

        <Link
          href="/portal/ordrer"
          className="flex items-center gap-4 rounded-xl bg-white px-5 py-4 shadow-sm ring-1 ring-gray-200 hover:bg-gray-50"
        >
          <Package size={24} className="text-blue-600" />
          <div>
            <div className="font-semibold text-gray-900">Mine ordrer</div>
            <div className="text-xs text-gray-500">Se status og historik</div>
          </div>
          <ChevronRight size={18} className="ml-auto text-gray-400" />
        </Link>
      </div>

      {/* Auktioner — resumé (skriver "Ingen auktion" hvis tom) */}
      <AuktionForsideWidget />

      {/* Beskeder fra Venmark */}
      {newestMessages.length > 0 && (
        <div>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-base font-semibold text-gray-900 flex items-center gap-2">
              <MessageSquare size={17} className="text-blue-600" />
              Beskeder fra Venmark
              {unreadMessages > 0 && (
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-blue-600 text-xs font-bold text-white">{unreadMessages}</span>
              )}
            </h2>
            <Link href="/portal/beskeder" className="text-xs text-blue-600 hover:underline">Se alle</Link>
          </div>
          <div className="divide-y divide-gray-100 overflow-hidden rounded-xl bg-white ring-1 ring-gray-200">
            {(newestMessages as any[]).map((m: any) => (
              <Link key={m.id} href="/portal/beskeder" className={`flex items-start gap-3 px-4 py-3 hover:bg-gray-50 ${!m.readByCustomer && m.sender === 'admin' ? 'bg-blue-50' : ''}`}>
                <div className="mt-0.5 shrink-0">
                  {m.sender === 'admin'
                    ? <div className="flex h-7 w-7 items-center justify-center rounded-full bg-blue-600 text-xs font-bold text-white">V</div>
                    : <div className="flex h-7 w-7 items-center justify-center rounded-full bg-gray-200 text-xs font-bold text-gray-600">Du</div>}
                </div>
                <div className="min-w-0 flex-1">
                  <p className={`text-sm truncate ${!m.readByCustomer && m.sender === 'admin' ? 'font-semibold text-gray-900' : 'text-gray-700'}`}>{m.body}</p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {new Date(m.createdAt).toLocaleDateString('da-DK', { weekday: 'short', day: 'numeric', month: 'short' })}
                    {' · '}{new Date(m.createdAt).toLocaleTimeString('da-DK', { hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>
                {!m.readByCustomer && m.sender === 'admin' && (
                  <span className="shrink-0 h-2 w-2 mt-2 rounded-full bg-blue-600" />
                )}
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Ticket-notifikation */}
      {(openTickets > 0 || unreadTicketMessages > 0) && (
        <Link
          href="/portal/reklamationer"
          className={`flex items-center gap-4 rounded-xl px-5 py-4 ring-1 transition ${
            unreadTicketMessages > 0
              ? 'bg-blue-50 ring-blue-200 hover:bg-blue-100'
              : 'bg-white ring-gray-200 hover:bg-gray-50'
          }`}
        >
          <MessageSquareWarning size={22} className={unreadTicketMessages > 0 ? 'text-blue-600' : 'text-gray-400'} />
          <div className="flex-1">
            <div className="text-sm font-semibold text-gray-900">
              {unreadTicketMessages > 0
                ? `${unreadTicketMessages} ny${unreadTicketMessages > 1 ? 'e beskeder' : ' besked'} på din reklamation`
                : `${openTickets} åben${openTickets > 1 ? 'e reklamationer' : ' reklamation'}`}
            </div>
            <div className="text-xs text-gray-500 mt-0.5">Tryk for at se og svare</div>
          </div>
          {unreadTicketMessages > 0 && (
            <span className="shrink-0 flex h-7 w-7 items-center justify-center rounded-full bg-blue-600 text-sm font-bold text-white">
              {unreadTicketMessages}
            </span>
          )}
          <ChevronRight size={16} className="shrink-0 text-gray-400" />
        </Link>
      )}

      {/* Seneste ordrer */}
      <div>
        <h2 className="mb-3 text-base font-semibold text-gray-900">Seneste ordrer</h2>
        {recentOrders.length === 0 ? (
          <div className="rounded-xl bg-white px-5 py-8 text-center text-sm text-gray-500 ring-1 ring-gray-200">
            Ingen ordrer endnu.{' '}
            <Link href="/portal/bestil" className="text-blue-600 hover:underline">
              Opret din første bestilling
            </Link>
          </div>
        ) : (
          <div className="divide-y divide-gray-100 overflow-hidden rounded-xl bg-white ring-1 ring-gray-200">
            {recentOrders.map((order) => {
              const st = statusLabel[order.status] ?? { label: order.status, color: 'text-gray-500 bg-gray-100' }
              return (
                <Link
                  key={order.id}
                  href={`/portal/ordrer/${order.id}`}
                  className="flex items-center justify-between px-5 py-4 hover:bg-gray-50"
                >
                  <div>
                    <div className="text-sm font-medium text-gray-900">
                      {order.bcOrderNumber ?? `Ordre ${order.id.slice(-6).toUpperCase()}`}
                    </div>
                    <div className="mt-0.5 text-xs text-gray-500">
                      {order.deliveryDate.toLocaleDateString('da-DK', { weekday: 'short', day: 'numeric', month: 'short' })}
                      {' · '}
                      {order.lines.length} {order.lines.length === 1 ? 'linje' : 'linjer'}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${st.color}`}>
                      {st.label}
                    </span>
                    <ChevronRight size={16} className="text-gray-400" />
                  </div>
                </Link>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
