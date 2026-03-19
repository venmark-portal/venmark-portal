import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { redirect } from 'next/navigation'
import StandingOrdersClient from '@/components/portal/StandingOrdersClient'
import { nextOccurrenceOfWeekday, getDeadlineForDelivery } from '@/lib/dateUtils'

export const dynamic = 'force-dynamic'

export default async function StandingOrdersPage() {
  const session = await getServerSession(authOptions)
  if (!session?.user) redirect('/portal/login')
  const customerId = (session.user as any).id

  // Hent alle faste ordrer for kunden (1 pr. ugedag)
  const standing = await prisma.standingOrder.findMany({
    where:   { customerId },
    include: { lines: { orderBy: { sortOrder: 'asc' } } },
  })

  // Byg et map weekday → lines
  const byWeekday: Record<number, { bcItemNumber: string; itemName: string; quantity: number; uom: string }[]> = {}
  for (const so of standing) {
    byWeekday[so.weekday] = so.lines.map((l) => ({
      bcItemNumber: l.bcItemNumber,
      itemName:     l.itemName,
      quantity:     l.quantity,
      uom:          l.uom,
    }))
  }

  // Beregn næste leveringsdag + deadline per ugedag
  const now = new Date()
  const weekdays = [1, 2, 3, 4, 5].map((wd) => {
    const delivery = nextOccurrenceOfWeekday(wd)
    const deadline = getDeadlineForDelivery(delivery)
    return {
      weekday:        wd,
      deliveryLabel:  delivery.toLocaleDateString('da-DK', { weekday: 'long', day: 'numeric', month: 'short' }),
      deadlinePassed: now > deadline,
      lines:          byWeekday[wd] ?? [],
    }
  })

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Faste ordrer</h1>
        <p className="mt-1 text-sm text-gray-500">
          Opret en ugentlig skabelon per leveringsdag — send med ét klik
        </p>
      </div>
      <StandingOrdersClient weekdays={weekdays} />
    </div>
  )
}
