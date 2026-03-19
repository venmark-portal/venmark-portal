import { prisma } from '@/lib/prisma'
import ApprovalList from '@/components/admin/ApprovalList'

export const dynamic = 'force-dynamic'

export default async function AdminDashboard() {
  // Hent alle afventende ordrer med linjer og kunde
  const orders = await prisma.order.findMany({
    where:   { status: 'SUBMITTED' },
    orderBy: { deliveryDate: 'asc' },
    include: {
      lines:    true,
      customer: { select: { id: true, name: true, bcCustomerNumber: true } },
    },
  })

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Godkendelse</h1>
          <p className="mt-1 text-sm text-gray-500">
            {orders.length === 0
              ? 'Ingen ordrer afventer godkendelse'
              : `${orders.length} ${orders.length === 1 ? 'ordre afventer' : 'ordrer afventer'}`}
          </p>
        </div>
      </div>

      <ApprovalList initialOrders={orders} />
    </div>
  )
}
