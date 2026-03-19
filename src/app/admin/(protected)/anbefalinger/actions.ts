'use server'

import { prisma } from '@/lib/prisma'
import { revalidatePath } from 'next/cache'

export async function addPromotion(data: {
  bcItemNumber: string
  itemName:     string
  date:         string   // YYYY-MM-DD
  note?:        string
  priority?:    number
}) {
  const date = new Date(data.date + 'T12:00:00Z')  // UTC noon – undgår timezone-problemer
  await prisma.dailyPromotion.upsert({
    where:  { bcItemNumber_date: { bcItemNumber: data.bcItemNumber, date } },
    update: { itemName: data.itemName, note: data.note ?? null, priority: data.priority ?? 0 },
    create: { bcItemNumber: data.bcItemNumber, itemName: data.itemName, date, note: data.note ?? null, priority: data.priority ?? 0 },
  })
  revalidatePath('/admin/anbefalinger')
}

export async function removePromotion(id: string) {
  await prisma.dailyPromotion.delete({ where: { id } })
  revalidatePath('/admin/anbefalinger')
}

export async function getPromotionsForDate(dateStr: string) {
  const start = new Date(dateStr + 'T00:00:00Z')  // UTC-start af dagen
  const end   = new Date(dateStr + 'T23:59:59Z')  // UTC-slut af dagen
  return prisma.dailyPromotion.findMany({
    where:   { date: { gte: start, lte: end } },
    orderBy: { priority: 'desc' },
  })
}
