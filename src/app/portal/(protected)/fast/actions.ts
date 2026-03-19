'use server'

import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { revalidatePath } from 'next/cache'
import { nextOccurrenceOfWeekday, getDeadlineForDelivery } from '@/lib/dateUtils'

export type LineInput = {
  bcItemNumber: string
  itemName:     string
  quantity:     number
  uom:          string
}

async function getCustomerId() {
  const session = await getServerSession(authOptions)
  const id = (session?.user as any)?.id as string | undefined
  if (!id) throw new Error('Ikke logget ind')
  return id
}

/** Gemmer (upsert) skabelon for én ugedag */
export async function saveStandingOrderTemplate(
  weekday: number,
  lines:   LineInput[],
): Promise<void> {
  const customerId = await getCustomerId()

  const existing = await prisma.standingOrder.findFirst({
    where: { customerId, weekday },
  })

  if (existing) {
    // Erstat alle linjer
    await prisma.standingOrderLine.deleteMany({ where: { standingOrderId: existing.id } })
    if (lines.length > 0) {
      await prisma.standingOrderLine.createMany({
        data: lines.map((l, i) => ({ standingOrderId: existing.id, ...l, sortOrder: i })),
      })
    }
    await prisma.standingOrder.update({
      where: { id: existing.id },
      data:  { isActive: lines.length > 0, updatedAt: new Date() },
    })
  } else if (lines.length > 0) {
    await prisma.standingOrder.create({
      data: {
        customerId,
        weekday,
        isActive: true,
        lines: { create: lines.map((l, i) => ({ ...l, sortOrder: i })) },
      },
    })
  }

  revalidatePath('/portal/fast')
}

/** Opretter en rigtig ordre fra skabelonen for næste forekomst af ugedagen */
export async function orderFromTemplate(weekday: number): Promise<void> {
  const customerId = await getCustomerId()

  const standing = await prisma.standingOrder.findFirst({
    where:   { customerId, weekday, isActive: true },
    include: { lines: true },
  })

  if (!standing || standing.lines.length === 0) {
    throw new Error('Ingen varer i skabelonen for denne dag')
  }

  const deliveryDate = nextOccurrenceOfWeekday(weekday)
  const deadline     = getDeadlineForDelivery(deliveryDate)

  if (new Date() > deadline) {
    throw new Error('Deadline er passeret — prøv igen næste uge')
  }

  // Undgå dubletter: tjek om der allerede er en ordre for denne leveringsdato
  const dup = await prisma.order.findFirst({
    where: {
      customerId,
      deliveryDate: { gte: deliveryDate, lt: new Date(deliveryDate.getTime() + 86_400_000) },
      status:       { in: ['SUBMITTED', 'APPROVED', 'SENT_TO_BC', 'CONFIRMED'] },
    },
  })
  if (dup) throw new Error('Der er allerede sendt en ordre til denne leveringsdato')

  await prisma.order.create({
    data: {
      customerId,
      type:        'STANDING',
      status:      'SUBMITTED',
      deliveryDate,
      deadline,
      submittedAt: new Date(),
      lines: {
        create: standing.lines.map((l) => ({
          bcItemNumber: l.bcItemNumber,
          itemName:     l.itemName,
          quantity:     l.quantity,
          uom:          l.uom,
          unitPrice:    0,
        })),
      },
    },
  })

  revalidatePath('/portal/ordrer')
  revalidatePath('/portal/fast')
}
