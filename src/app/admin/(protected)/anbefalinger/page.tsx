import { prisma } from '@/lib/prisma'
import AnbefalingerManager from '@/components/admin/AnbefalingerManager'

export const dynamic = 'force-dynamic'

export default async function AnbefalingerPage() {
  // Hent anbefalinger for de næste 7 dage
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const nextWeek = new Date(today.getTime() + 7 * 86_400_000)

  const promotions = await prisma.dailyPromotion.findMany({
    where:   { date: { gte: today, lt: nextWeek } },
    orderBy: [{ date: 'asc' }, { priority: 'desc' }],
  })

  // Formater today som YYYY-MM-DD for default dato
  const todayStr = today.toISOString().split('T')[0]

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Anbefalinger</h1>
        <p className="mt-1 text-sm text-gray-500">
          Styr hvilke varer der vises som dagens anbefalinger for kunderne
        </p>
      </div>
      <AnbefalingerManager initialPromotions={promotions} defaultDate={todayStr} />
    </div>
  )
}
