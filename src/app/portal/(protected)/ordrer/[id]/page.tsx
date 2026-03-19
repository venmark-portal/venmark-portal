import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { redirect } from 'next/navigation'
import { ArrowLeft, RefreshCw, PlusCircle } from 'lucide-react'
import { getPortalLineStatuses } from '@/lib/businesscentral'
import OrderLineStatus from '@/components/portal/OrderLineStatus'
import Link from 'next/link'

export const dynamic = 'force-dynamic'

const STATUS: Record<string, { label: string; cls: string }> = {
  DRAFT:      { label: 'Kladde',    cls: 'bg-gray-100   text-gray-600'   },
  SUBMITTED:  { label: 'Afventer', cls: 'bg-amber-100  text-amber-700'  },
  APPROVED:   { label: 'Godkendt', cls: 'bg-blue-100   text-blue-700'   },
  SENT_TO_BC: { label: 'Modtaget', cls: 'bg-green-100  text-green-700'  },
  CONFIRMED:  { label: 'Bekræftet',cls: 'bg-green-100  text-green-700'  },
  REJECTED:   { label: 'Afvist',   cls: 'bg-red-100    text-red-700'    },
}

export default async function OrderDetailPage({ params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) redirect('/portal/login')

  const customerId = (session.user as any).id

  const order = await prisma.order.findUnique({
    where:   { id: params.id },
    include: { lines: true },
  })

  if (!order || order.customerId !== customerId) redirect('/portal/ordrer')

  // Hent BC-linjestatus hvis tilgængeligt
  const bcLines = order.bcOrderNumber
    ? await getPortalLineStatuses(order.bcOrderNumber)
    : null

  const fmt = new Intl.NumberFormat('da-DK', { style: 'currency', currency: 'DKK', minimumFractionDigits: 2 })
  const st = STATUS[order.status] ?? STATUS.DRAFT
  const total = order.lines.reduce((s, l) => s + l.quantity * l.unitPrice, 0)
  const withinDeadline = new Date() < new Date(order.deadline) && order.status !== 'REJECTED'

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link href="/portal/ordrer" className="text-gray-400 hover:text-gray-600">
          <ArrowLeft size={20} />
        </Link>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-bold text-gray-900">
              {order.bcOrderNumber ? `#${order.bcOrderNumber}` : 'Ordre'}
            </h1>
            <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${st.cls}`}>
              {st.label}
            </span>
            {order.type === 'STANDING' && (
              <span className="inline-flex items-center gap-1 rounded-full bg-purple-100 px-2 py-0.5 text-xs font-medium text-purple-700">
                <RefreshCw size={10} />
                Fast ordre
              </span>
            )}
          </div>
          <div className="mt-0.5 text-xs text-gray-500">
            Levering{' '}
            {new Date(order.deliveryDate).toLocaleDateString('da-DK', {
              weekday: 'long', day: 'numeric', month: 'long',
            })}
          </div>
        </div>
      </div>

      {/* Info-kort */}
      <div className="rounded-xl bg-white ring-1 ring-gray-200 divide-y divide-gray-100 text-sm">
        <div className="flex justify-between px-4 py-2.5 text-gray-500">
          <span>Bestilt</span>
          <span className="text-gray-800">
            {new Date(order.createdAt).toLocaleDateString('da-DK', {
              day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
            })}
          </span>
        </div>
        <div className="flex justify-between px-4 py-2.5 text-gray-500">
          <span>Deadline</span>
          <span className={`font-medium ${withinDeadline ? 'text-green-600' : 'text-red-500'}`}>
            {new Date(order.deadline).toLocaleDateString('da-DK', {
              day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
            })}
          </span>
        </div>
        {total > 0 && (
          <div className="flex justify-between px-4 py-2.5 text-gray-500">
            <span>Total</span>
            <span className="font-semibold text-gray-800">{fmt.format(total)}</span>
          </div>
        )}
        {order.notes && (
          <div className="flex justify-between px-4 py-2.5 text-gray-500">
            <span>Note</span>
            <span className="text-gray-800 italic">{order.notes}</span>
          </div>
        )}
      </div>

      {/* Tilføj vare */}
      {withinDeadline && (
        <Link
          href={`/portal/ordrer/${order.id}/tilfoej`}
          className="inline-flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-800"
        >
          <PlusCircle size={15} />
          Tilføj vare til denne ordre
        </Link>
      )}

      {/* Ordrelinjer */}
      <div>
        <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-gray-400">
          {order.lines.length} {order.lines.length === 1 ? 'linje' : 'linjer'}
        </p>
        <div className="overflow-hidden rounded-xl bg-white ring-1 ring-gray-200">
          {order.lines.map((line) => {
            const bcLine = bcLines?.find((b) => b.lineObjectNumber === line.bcItemNumber)
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
    </div>
  )
}
