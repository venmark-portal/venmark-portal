import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getDeadlineForDelivery } from '@/lib/dateUtils'
import { sendOrderNotification } from '@/lib/email'
import { createBCSalesOrder } from '@/lib/businesscentral'

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) {
    return NextResponse.json({ error: 'Ikke logget ind' }, { status: 401 })
  }

  const userId = (session.user as any)?.id as string

  try {
    const body = await req.json()
    const { deliveryDate: deliveryDateStr, notes, lines } = body

    if (!deliveryDateStr || !lines?.length) {
      return NextResponse.json({ error: 'Mangler leveringsdato eller linjer' }, { status: 400 })
    }

    const deliveryDate = new Date(deliveryDateStr)
    const deadline     = getDeadlineForDelivery(deliveryDate)

    // Tjek deadline
    if (new Date() > deadline) {
      return NextResponse.json(
        { error: `Deadline for denne dato er passeret (${deadline.toLocaleTimeString('da-DK', { hour: '2-digit', minute: '2-digit' })})` },
        { status: 422 }
      )
    }

    const customer = await prisma.customer.findUnique({ where: { id: userId } })
    if (!customer) {
      return NextResponse.json({ error: 'Kunde ikke fundet' }, { status: 404 })
    }

    // Gem ordre i DB — nye felter (driverNote, poNumber, orderedByName, orderedByEmail)
    // tilføjes via $executeRaw da prisma generate ikke er kørt (DLL-lock workaround)
    const order = await prisma.order.create({
      data: {
        customerId:  userId,
        type:        'ONEOFF',
        status:      'SUBMITTED',
        deliveryDate,
        deadline,
        notes:       notes ?? null,
        submittedAt: new Date(),
        lines: {
          create: lines.map((l: any) => ({
            bcItemNumber: l.bcItemNumber,
            itemName:     l.itemName,
            quantity:     l.quantity,
            uom:          l.uom,
            unitPrice:    l.unitPrice ?? 0,
            status:       'PENDING',
          })),
        },
      },
      include: { lines: true },
    })

    // Sæt de nye felter som Prisma-klienten ikke kender endnu
    await prisma.$executeRaw`
      UPDATE "Order"
      SET "driverNote"     = ${body.driverNote ?? null},
          "poNumber"       = ${body.poNumber ?? null},
          "orderedByName"  = ${(session.user as any)?.name ?? null},
          "orderedByEmail" = ${(session.user as any)?.email ?? null}
      WHERE id = ${order.id}
    `

    // Send direkte til BC — linjer oprettes med shipQuantity=0 (afventer godkendelse)
    try {
      const bc = await createBCSalesOrder(
        customer.bcCustomerNumber,
        deliveryDate,
        order.id,
        order.lines.map((l) => ({
          itemNumber: l.bcItemNumber,
          quantity:   l.quantity,
          uomCode:    l.uom,
        })),
      )

      // Opdater til SENT_TO_BC med BC-referencer
      await prisma.order.update({
        where: { id: order.id },
        data:  {
          status:       'SENT_TO_BC',
          bcOrderNumber: bc.number,
          bcOrderId:    bc.id,
          approvedAt:   new Date(),
        },
      })

      // Send email-notifikation
      await sendOrderNotification({
        customer,
        order: { ...order, status: 'SENT_TO_BC', bcOrderNumber: bc.number },
        lines: order.lines,
      }).catch((e) => console.warn('Email-notifikation fejlede:', e.message))

      return NextResponse.json({ orderId: order.id, bcOrderNumber: bc.number }, { status: 201 })

    } catch (bcErr: any) {
      // BC fejlede — behold SUBMITTED så admin kan gensende manuelt
      console.error('BC-fejl ved ordreindsendelsse:', bcErr.message)

      await sendOrderNotification({
        customer,
        order,
        lines: order.lines,
      }).catch((e) => console.warn('Email-notifikation fejlede:', e.message))

      // Returner success til kunden — ordren er gemt og admin notificeres
      return NextResponse.json({ orderId: order.id, bcWarning: 'Ordre modtaget — behandles snarest' }, { status: 201 })
    }

  } catch (e: any) {
    console.error('Ordre-fejl:', e)
    return NextResponse.json({ error: 'Serverfejl' }, { status: 500 })
  }
}
