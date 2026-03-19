import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { addLinesToBCOrder } from '@/lib/businesscentral'

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Ikke logget ind' }, { status: 401 })

  const customerId = (session.user as any)?.id as string
  const orderId    = params.id

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { lines: true },
  })

  if (!order || order.customerId !== customerId) {
    return NextResponse.json({ error: 'Ordre ikke fundet' }, { status: 404 })
  }

  if (new Date() > new Date(order.deadline)) {
    return NextResponse.json({ error: 'Deadline er passeret' }, { status: 422 })
  }

  if (order.status === 'REJECTED') {
    return NextResponse.json({ error: 'Ordren er afvist' }, { status: 422 })
  }

  const { lines } = await req.json()
  if (!lines?.length) {
    return NextResponse.json({ error: 'Ingen linjer' }, { status: 400 })
  }

  // Gem nye linjer i DB
  const created = await prisma.$transaction(
    lines.map((l: any) =>
      prisma.orderLine.create({
        data: {
          orderId:      orderId,
          bcItemNumber: l.bcItemNumber,
          itemName:     l.itemName,
          quantity:     l.quantity,
          uom:          l.uom,
          unitPrice:    l.unitPrice ?? 0,
          status:       'PENDING',
        },
      })
    )
  )

  // Send til BC hvis ordren allerede er i BC
  if (order.bcOrderId) {
    const { errors } = await addLinesToBCOrder(
      order.bcOrderId,
      lines.map((l: any) => ({
        itemNumber: l.bcItemNumber,
        quantity:   l.quantity,
        uomCode:    l.uom,
      })),
    )
    if (errors.length > 0) {
      console.error('BC linje-fejl ved tilføjelse:', errors)
    }
  }

  return NextResponse.json({ added: created.length }, { status: 201 })
}
