import { prisma } from '@/lib/prisma'
import CustomerManager from '@/components/admin/CustomerManager'

export const dynamic = 'force-dynamic'

export default async function KunderPage() {
  const customers = await prisma.customer.findMany({
    orderBy: { name: 'asc' },
    select: {
      id:               true,
      name:             true,
      email:            true,
      bcCustomerNumber:    true,
      bcPriceGroup:        true,
      bcStandardSalesCode: true,
      isActive:            true,
      createdAt:        true,
      _count:           { select: { orders: true } },
    },
  })

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Kunder</h1>
        <p className="mt-1 text-sm text-gray-500">
          {customers.length} {customers.length === 1 ? 'kunde' : 'kunder'} i alt
        </p>
      </div>
      <CustomerManager initialCustomers={customers} />
    </div>
  )
}
