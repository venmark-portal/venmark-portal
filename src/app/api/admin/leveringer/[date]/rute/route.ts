import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { randomUUID } from 'crypto'

export const runtime = 'nodejs'

// POST: Gem/opdater rute for en dag (opretter eller overskriver)
export async function POST(
  req: NextRequest,
  { params }: { params: { date: string } }
) {
  const session = await getServerSession(authOptions)
  if (!session || (session.user as any)?.role !== 'admin') {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  const { vehicles, notes } = await req.json()
  // vehicles: Array<{ id?, vehicleLabel, driverId, stops: Array<{ id?, ... }> }>

  const now = new Date().toISOString()

  // Find eller opret rute
  const existing = await prisma.$queryRaw<any[]>`
    SELECT id FROM DeliveryRoute WHERE date(bookingDate) = ${params.date} LIMIT 1
  `
  let routeId: string
  if (existing.length > 0) {
    routeId = existing[0].id
    await prisma.$executeRaw`UPDATE DeliveryRoute SET notes=${notes ?? null}, updatedAt=${now} WHERE id=${routeId}`
    // Slet eksisterende vehicles + stops (cascade)
    await prisma.$executeRaw`DELETE FROM RouteVehicle WHERE routeId=${routeId}`
  } else {
    routeId = randomUUID()
    await prisma.$executeRaw`
      INSERT INTO DeliveryRoute (id, bookingDate, status, notes, createdAt, updatedAt)
      VALUES (${routeId}, ${params.date}, 'DRAFT', ${notes ?? null}, ${now}, ${now})
    `
  }

  // Indsæt vehicles + stops
  for (let vi = 0; vi < vehicles.length; vi++) {
    const v = vehicles[vi]
    const vehicleId = randomUUID()
    await prisma.$executeRaw`
      INSERT INTO RouteVehicle (id, routeId, vehicleLabel, driverId, sortOrder)
      VALUES (${vehicleId}, ${routeId}, ${v.vehicleLabel ?? `Bil ${vi + 1}`}, ${v.driverId ?? null}, ${vi})
    `
    const stops = v.stops ?? []
    for (let si = 0; si < stops.length; si++) {
      const s = stops[si]
      await prisma.$executeRaw`
        INSERT INTO RouteStop (
          id, vehicleId, driverId, sortOrder, deliveryCodeId, deliveryCodeOverride,
          bcSalesOrderNo, bcSalesOrderId, bcPurchaseOrderNo, bcPurchaseOrderId,
          isExtraTask, extraTaskTitle, extraTaskNote,
          customerName, customerAddress, customerPhone, totalWeightKg,
          status, createdAt
        ) VALUES (
          ${randomUUID()}, ${vehicleId}, ${s.driverId ?? null}, ${si},
          ${s.deliveryCodeId ?? null}, ${s.deliveryCodeOverride ?? null},
          ${s.bcSalesOrderNo ?? null}, ${s.bcSalesOrderId ?? null},
          ${s.bcPurchaseOrderNo ?? null}, ${s.bcPurchaseOrderId ?? null},
          ${s.isExtraTask ? 1 : 0}, ${s.extraTaskTitle ?? null}, ${s.extraTaskNote ?? null},
          ${s.customerName ?? null}, ${s.customerAddress ?? null}, ${s.customerPhone ?? null},
          ${s.totalWeightKg ?? null}, 'PENDING', ${now}
        )
      `
    }
  }

  return NextResponse.json({ routeId })
}
