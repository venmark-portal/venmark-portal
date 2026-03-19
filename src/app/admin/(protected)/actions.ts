'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { createBCSalesOrder, addLinesToBCOrder } from '@/lib/businesscentral'

// ─── Typer ────────────────────────────────────────────────────────────────────

export interface ApproveResult {
  id:             string
  bcOrderNumber?: string   // sat hvis BC oprettelse lykkedes
  bcError?:       string   // sat hvis BC fejlede (ordre er stadig APPROVED lokalt)
  lineErrors?:    string[] // sat hvis nogle linjer fejlede (ordre oprettet men ufuldstændig)
}

// ─── Godkend ordrer ───────────────────────────────────────────────────────────

export async function approveOrders(
  orderIds: string[],
): Promise<{ results: ApproveResult[] }> {
  const results: ApproveResult[] = []

  for (const id of orderIds) {
    try {
      const order = await prisma.order.findUnique({
        where:   { id },
        include: {
          lines:    true,
          customer: { select: { bcCustomerNumber: true } },
        },
      })

      if (!order) {
        results.push({ id, bcError: 'Ordre ikke fundet i databasen' })
        continue
      }

      // ── Forsøg BC-oprettelse ──────────────────────────────────────────────
      let bcOrderNumber: string | undefined

      try {
        const bc = await createBCSalesOrder(
          order.customer.bcCustomerNumber,
          order.deliveryDate,
          order.id,
          order.lines.map((l) => ({
            itemNumber: l.bcItemNumber,
            quantity:   l.quantity,
            uomCode:    l.uom,
          })),
        )
        bcOrderNumber = bc.number
      } catch (bcErr) {
        // BC fejl — godkend alligevel lokalt, men marker fejlen
        const msg = bcErr instanceof Error ? bcErr.message : String(bcErr)
        console.error(`BC fejl for ordre ${id}:`, msg)

        await prisma.order.update({
          where: { id },
          data:  { status: 'APPROVED', approvedAt: new Date() },
        })

        results.push({ id, bcError: msg })
        continue
      }

      // ── BC lykkedes — opdater til SENT_TO_BC ─────────────────────────────
      await prisma.order.update({
        where: { id },
        data:  { status: 'SENT_TO_BC', bcOrderNumber, bcOrderId: bc.id, approvedAt: new Date() },
      })

      results.push({ id, bcOrderNumber, ...(bc.lineErrors && { lineErrors: bc.lineErrors }) })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      results.push({ id, bcError: msg })
    }
  }

  revalidatePath('/admin')
  return { results }
}

// ─── Afvis ordrer ─────────────────────────────────────────────────────────────

export async function rejectOrders(orderIds: string[]) {
  await prisma.order.updateMany({
    where: { id: { in: orderIds }, status: 'SUBMITTED' },
    data:  { status: 'REJECTED' },
  })
  revalidatePath('/admin')
}

// ─── Gensend linjer til BC (for ordrer der allerede er oprettet i BC) ─────────

export async function retryOrderLines(
  orderIds: string[],
): Promise<{ results: Array<{ id: string; bcOrderNumber: string; success: number; errors: string[] }> }> {
  const results = []

  for (const id of orderIds) {
    const order = await prisma.order.findUnique({
      where:   { id },
      include: { lines: true },
    })

    if (!order?.bcOrderId) continue

    const { success, errors } = await addLinesToBCOrder(
      order.bcOrderId,
      order.lines.map((l) => ({
        itemNumber: l.bcItemNumber,
        quantity:   l.quantity,
        uomCode:    l.uom,
      })),
    )

    results.push({ id, bcOrderNumber: order.bcOrderNumber, success, errors })
  }

  revalidatePath('/admin')
  return { results }
}
