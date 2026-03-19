import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { redirect } from 'next/navigation'
import { Package, Clock, CheckCircle2, Truck, XCircle, RefreshCw, PlusCircle, ChevronRight } from 'lucide-react'
import { getPortalLineStatuses, BCPortalLine } from '@/lib/businesscentral'
import OrderLineStatus from '@/components/portal/OrderLineStatus'
import Link from 'next/link'

export const dynamic = 'force-dynamic'

const STATUS: Record<string, { label: string; cls: string; Icon: React.ElementType }> = {
  DRAFT:      { label: 'Kladde',        cls: 'bg-gray-100  text-gray-600',    Icon: Clock         },
  SUBMITTED:  { label: 'Afventer',      cls: 'bg-amber-100 text-amber-700',   Icon: Clock         },
  APPROVED:   { label: 'Godkendt',      cls: 'bg-blue-100  text-blue-700',    Icon: CheckCircle2  },
  SENT_TO_BC: { label: 'Modtaget',      cls: 'bg-green-100 text-green-700',   Icon: Truck         },
  CONFIRMED:  { label: 'Bekræftet',     cls: 'bg-green-100 text-green-700',   Icon: CheckCircle2  },
  REJECTED:   { label: 'Afvist',        cls: 'bg-red-100   text-red-700',     Icon: XCircle       },
}

export default async function MyOrdersPage() {
  const session = await getServerSession(authOptions)
  if (!session?.user) redirect('/portal/login')
  const customerId = (session.user as any).id

  const orders = await prisma.order.findMany({
    where:   { customerId },
    orderBy: { deliveryDate: 'desc' },
    include: { lines: true },
    take:    60,
  })

  // Hent BC-linjestatus for alle SENT_TO_BC ordrer parallelt
  const bcLineMap = new Map<string, BCPortalLine[]>()
  await Promise.all(
    orders
      .filter((o) => o.bcOrderNumber && (o.status === 'SENT_TO_BC' || o.status === 'CONFIRMED'))
      .map(async (o) => {
        const lines = await getPortalLineStatuses(o.bcOrderNumber!)
        if (lines) bcLineMap.set(o.id, lines)
      })
  )

  const fmt = new Intl.NumberFormat('da-DK', {
    style: 'currency', currency: 'DKK', minimumFractionDigits: 2,
  })
  // fmt bruges kun til totalen i ordre-headeren — ikke sendt til client komponenter

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Mine ordrer</h1>
        <p className="mt-1 text-sm text-gray-500">
          {orders.length === 0
            ? 'Ingen ordrer endnu'
            : `${orders.length} ${orders.length === 1 ? 'ordre' : 'ordrer'} i alt`}
        </p>
      </div>

      {orders.length === 0 ? (
        <div className="rounded-xl bg-white px-6 py-16 text-center text-gray-500 ring-1 ring-gray-200">
          <Package size={40} className="mx-auto mb-3 text-gray-300" />
          <p className="font-medium">Ingen ordrer endnu</p>
          <p className="mt-2 text-sm">
            <a href="/portal/bestil" className="text-blue-600 hover:underline">Opret din første bestilling →</a>
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {orders.map((order) => {
            const st         = STATUS[order.status] ?? STATUS.DRAFT
            const { Icon }   = st
            const total      = order.lines.reduce((s, l) => s + l.quantity * l.unitPrice, 0)
            const isStanding = order.type === 'STANDING'
            const bcLines    = bcLineMap.get(order.id)

            return (
              <div key={order.id} className="overflow-hidden rounded-xl bg-white ring-1 ring-gray-200">
                {/* Header — klik for at åbne ordredetaljer */}
                <Link
                  href={`/portal/ordrer/${order.id}`}
                  className="flex items-start gap-3 px-4 py-3 hover:bg-gray-50 transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-gray-900">
                        Levering{' '}
                        {new Date(order.deliveryDate).toLocaleDateString('da-DK', {
                          weekday: 'long', day: 'numeric', month: 'short',
                        })}
                      </span>
                      <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${st.cls}`}>
                        <Icon size={10} />
                        {st.label}
                      </span>
                      {isStanding && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-purple-100 px-2 py-0.5 text-xs font-medium text-purple-700">
                          <RefreshCw size={10} />
                          Fast ordre
                        </span>
                      )}
                      {order.bcOrderNumber && (
                        <span className="rounded bg-gray-50 px-1.5 py-0.5 font-mono text-xs text-gray-500">
                          #{order.bcOrderNumber}
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 text-xs text-gray-400">
                      Bestilt{' '}
                      {new Date(order.createdAt).toLocaleDateString('da-DK', {
                        day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
                      })}
                      {total > 0 && ` · ${fmt.format(total)}`}
                      {order.notes && ` · „${order.notes}"`}
                    </div>
                  </div>
                  <ChevronRight size={16} className="mt-1 shrink-0 text-gray-300" />
                </Link>

                {/* Tilføj vare — kun hvis inden deadline */}
                {new Date() < new Date(order.deadline) && order.status !== 'REJECTED' && (
                  <div className="border-t border-gray-100 px-4 py-2">
                    <a
                      href={`/portal/ordrer/${order.id}/tilfoej`}
                      className="inline-flex items-center gap-1.5 text-xs text-blue-600 hover:text-blue-800"
                    >
                      <PlusCircle size={13} />
                      Tilføj vare
                    </a>
                  </div>
                )}

                {/* Ordrelinjer */}
                <div className="divide-y divide-gray-50 border-t border-gray-100">
                  {order.lines.map((line) => {
                    const bcLine = bcLines?.find(
                      (b) => b.lineObjectNumber === line.bcItemNumber,
                    )
                    return (
                      <OrderLineStatus
                        key={line.id}
                        itemNumber={line.bcItemNumber}
                        itemName={line.itemName}
                        quantity={line.quantity}
                        uom={line.uom}
                        unitPrice={line.unitPrice}
                        portalLineStatus={bcLine?.portalLineStatus ?? null}
                        portalCustomerNote={bcLine?.portalCustomerNote ?? null}
                      />
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
