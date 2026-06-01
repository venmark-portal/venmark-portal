import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getDeadlineForDelivery, getDeadlineForMethodDelivery } from '@/lib/dateUtils'
import { sendOrderNotification } from '@/lib/email'
import { createBCSalesOrder, flagBeskedUlaest, getPortalShipmentMethods, getPortalCalendarDays } from '@/lib/businesscentral'

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) {
    return NextResponse.json({ error: 'Ikke logget ind' }, { status: 401 })
  }

  const userId = (session.user as any)?.id as string

  try {
    const body = await req.json()
    const { deliveryDate: deliveryDateStr, notes, lines, shipmentMethodCode, poNumber } = body

    if (!deliveryDateStr || !lines?.length) {
      return NextResponse.json({ error: 'Mangler leveringsdato eller linjer' }, { status: 400 })
    }

    const deliveryDate = new Date(deliveryDateStr)

    // Beregn deadline med leveringsmetode-logik hvis muligt, ellers simpel fallback
    let deadline: Date
    if (shipmentMethodCode) {
      const toDate90 = new Date(); toDate90.setDate(toDate90.getDate() + 90)
      const today8601 = new Date().toISOString().split('T')[0]
      const [allMethods, calendarDays] = await Promise.all([
        getPortalShipmentMethods().catch(() => []),
        getPortalCalendarDays(today8601, toDate90.toISOString().split('T')[0]).catch(() => []),
      ])
      const method = allMethods.find(m => m.code === shipmentMethodCode)
      deadline = method
        ? getDeadlineForMethodDelivery(deliveryDate, method, calendarDays)
        : getDeadlineForDelivery(deliveryDate)
    } else {
      deadline = getDeadlineForDelivery(deliveryDate)
    }

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

    // Link specialvare-reservationer til ordren
    if (body.reservationIds?.length) {
      await prisma.specialVareReservation.updateMany({
        where: { id: { in: body.reservationIds }, customerId: userId, status: 'PENDING' },
        data: { orderId: order.id, status: 'CONFIRMED' },
      })
    }

    // Opret portal-besked hvis kunden har skrevet en besked med ordren
    if (notes?.trim()) {
      const msgExpires = new Date(); msgExpires.setDate(msgExpires.getDate() + 30)
      const deliveryLabel = deliveryDate.toLocaleDateString('da-DK', { weekday: 'long', day: 'numeric', month: 'long' })
      const msgBody = `Besked ved ordre (levering ${deliveryLabel}):\n${notes.trim()}`
      await prisma.$executeRaw`
        INSERT INTO "Message" (id, "customerId", sender, "senderName", body, "readByAdmin", "readByCustomer", "createdAt", "expiresAt")
        VALUES (gen_random_uuid()::text, ${userId}, 'customer', ${customer.name}, ${msgBody}, false, true, NOW(), ${msgExpires})
      `
      // Notificer BC om ulæst besked
      if (customer.bcCustomerNumber) {
        flagBeskedUlaest(customer.bcCustomerNumber).catch(() => {})
      }
    }

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
        poNumber ?? undefined,
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
