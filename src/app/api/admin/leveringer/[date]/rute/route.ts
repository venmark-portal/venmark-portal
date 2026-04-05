import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { randomUUID } from 'crypto'

export const runtime = 'nodejs'

export async function POST(
  req: NextRequest,
  { params }: { params: { date: string } }
) {
  const session = await getServerSession(authOptions)
  if (!session || (session.user as any)?.role !== 'admin') {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  const { vehicles, notes, routeProfiles } = await req.json()
  // routeProfiles: Array<{ customerNo: string; routeOrder: number; defaultVehicle: number }>

  const now = new Date().toISOString()

  // Gem ruterækkefølge + standardbil per kunde (persistent på tværs af dage)
  if (routeProfiles?.length) {
    await prisma.$executeRaw`
      CREATE TABLE IF NOT EXISTS "CustomerRouteProfile" (
        "customerNo"      TEXT    PRIMARY KEY,
        "routeOrder"      INTEGER NOT NULL DEFAULT 5000,
        "defaultVehicle"  INTEGER NOT NULL DEFAULT 0,
        "updatedAt"       TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `
    await prisma.$executeRaw`
      ALTER TABLE "CustomerRouteProfile"
        ADD COLUMN IF NOT EXISTS "defaultVehicle" INTEGER NOT NULL DEFAULT 0
    `
    for (const p of routeProfiles) {
      await prisma.$executeRaw`
        INSERT INTO "CustomerRouteProfile" ("customerNo", "routeOrder", "defaultVehicle", "updatedAt")
        VALUES (${p.customerNo}, ${p.routeOrder}, ${p.defaultVehicle ?? 0}, ${now}::timestamp)
        ON CONFLICT ("customerNo") DO UPDATE
          SET "routeOrder"     = EXCLUDED."routeOrder",
              "defaultVehicle" = EXCLUDED."defaultVehicle",
              "updatedAt"      = EXCLUDED."updatedAt"
      `
    }
  }

  // Find eller opret rute
  const existing = await prisma.$queryRaw<any[]>`
    SELECT id FROM "DeliveryRoute" WHERE date("bookingDate") = ${params.date}::date LIMIT 1
  `
  let routeId: string
  if (existing.length > 0) {
    routeId = existing[0].id
    await prisma.$executeRaw`
      UPDATE "DeliveryRoute" SET notes = ${notes ?? null}, "updatedAt" = ${now}::timestamp WHERE id = ${routeId}
    `
    await prisma.$executeRaw`DELETE FROM "RouteVehicle" WHERE "routeId" = ${routeId}`
  } else {
    routeId = randomUUID()
    await prisma.$executeRaw`
      INSERT INTO "DeliveryRoute" (id, "bookingDate", status, notes, "createdAt", "updatedAt")
      VALUES (${routeId}, ${params.date}::date, 'DRAFT', ${notes ?? null}, ${now}::timestamp, ${now}::timestamp)
    `
  }

  // Indsæt vehicles + stops
  for (let vi = 0; vi < vehicles.length; vi++) {
    const v = vehicles[vi]
    const vehicleId = randomUUID()
    await prisma.$executeRaw`
      INSERT INTO "RouteVehicle" (id, "routeId", "vehicleLabel", "driverId", "sortOrder")
      VALUES (${vehicleId}, ${routeId}, ${v.vehicleLabel ?? `Bil ${vi + 1}`}, ${v.driverId ?? null}, ${vi})
    `
    const stops = v.stops ?? []
    for (let si = 0; si < stops.length; si++) {
      const s = stops[si]
      await prisma.$executeRaw`
        INSERT INTO "RouteStop" (
          id, "vehicleId", "driverId", "sortOrder", "deliveryCodeId", "deliveryCodeOverride",
          "bcSalesOrderNo", "bcSalesOrderId", "bcPurchaseOrderNo", "bcPurchaseOrderId",
          "isExtraTask", "extraTaskTitle", "extraTaskNote",
          "customerName", "customerAddress", "customerPhone", "totalWeightKg",
          status, "createdAt"
        ) VALUES (
          ${randomUUID()}, ${vehicleId}, ${s.driverId ?? null}, ${si},
          ${s.deliveryCodeId ?? null}, ${s.deliveryCodeOverride ?? null},
          ${s.bcSalesOrderNo ?? null}, ${s.bcSalesOrderId ?? null},
          ${s.bcPurchaseOrderNo ?? null}, ${s.bcPurchaseOrderId ?? null},
          ${s.isExtraTask ? true : false}, ${s.extraTaskTitle ?? null}, ${s.extraTaskNote ?? null},
          ${s.customerName ?? null}, ${s.customerAddress ?? null}, ${s.customerPhone ?? null},
          ${s.totalWeightKg ?? null}, 'PENDING', ${now}::timestamp
        )
      `
    }
  }

  return NextResponse.json({ routeId })
}
