import { prisma } from '@/lib/prisma'
import OrderManager from '@/components/admin/OrderManager'

export const dynamic = 'force-dynamic'

export default async function OrdrerPage() {
  const since = new Date()
  since.setDate(since.getDate() - 30)

  const orders = await prisma.order.findMany({
    where: {
      submittedAt: { not: null, gte: since },
      status: { in: ['SUBMITTED', 'APPROVED', 'SENT_TO_BC', 'CONFIRMED', 'REJECTED'] },
    },
    orderBy: [{ status: 'asc' }, { submittedAt: 'desc' }],
    include: {
      customer: { select: { id: true, name: true, bcCustomerNumber: true } },
      lines:    true,
    },
  })

  // Datoer serialiseres til strenge til klient-komponent
  const serialized = orders.map(o => ({
    id:                o.id,
    bcOrderNumber:     o.bcOrderNumber,
    bcOrderId:         o.bcOrderId,
    type:              o.type,
    status:            o.status,
    deliveryDate:      o.deliveryDate.toISOString(),
    deadline:          o.deadline.toISOString(),
    submittedAt:       o.submittedAt?.toISOString() ?? null,
    approvedAt:        o.approvedAt?.toISOString() ?? null,
    notes:             o.notes,
    poNumber:          o.poNumber,
    driverNote:        o.driverNote,
    orderedByName:     o.orderedByName,
    orderedByEmail:    o.orderedByEmail,
    customer:          o.customer,
    lines:             o.lines.map(l => ({
      id:            l.id,
      bcItemNumber:  l.bcItemNumber,
      itemName:      l.itemName,
      quantity:      l.quantity,
      uom:           l.uom,
      unitPrice:     l.unitPrice,
      status:        l.status,
    })),
  }))

  const submittedCount = orders.filter(o => o.status === 'SUBMITTED').length
  const failedCount    = orders.filter(o => o.status === 'APPROVED').length

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Ordrer</h1>
        <p className="mt-1 text-sm text-gray-500">
          {orders.length} ordre(r) de seneste 30 dage
          {submittedCount > 0 && (
            <span className="ml-2 font-medium text-amber-700">
              · {submittedCount} afventer godkendelse
            </span>
          )}
          {failedCount > 0 && (
            <span className="ml-2 font-medium text-red-700">
              · {failedCount} mislykkedes mod BC (kan gensendes)
            </span>
          )}
        </p>
      </div>
      <OrderManager initialOrders={serialized} />
    </div>
  )
}
