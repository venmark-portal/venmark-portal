import { NextRequest, NextResponse } from 'next/server'
import { getToken } from 'next-auth/jwt'
import { randomUUID } from 'crypto'
import { prisma } from '@/lib/prisma'

export const runtime = 'nodejs'

/**
 * POST /api/chauffeur/rute/move  { stopId, toVehicle: "Bil N", permanent?: boolean }
 * Flytter et stop til en anden bil på dagens rute (bilen oprettes på ruten, hvis den mangler).
 * Stoppet lægges sidst i den nye bil. permanent = kundens standardbil sættes også,
 * så kunden havner i den bil fremover (samme som Std.bil på admin-siden).
 */
export async function POST(req: NextRequest) {
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET })
  if (!token || token.role !== 'driver') return new NextResponse('Unauthorized', { status: 401 })

  const { stopId, toVehicle, permanent } = await req.json() as { stopId?: string; toVehicle?: string; permanent?: boolean }
  const m = /^Bil (\d{1,2})$/.exec(String(toVehicle ?? ''))
  if (!stopId || !m) return NextResponse.json({ error: 'stopId og toVehicle ("Bil N") kræves' }, { status: 400 })
  const vehicleNo = Number(m[1])
  const now = new Date().toISOString()

  const result = await prisma.$transaction(async tx => {
    const stop = await tx.$queryRaw<{ id: string; vehicleId: string; routeId: string; bcCustomerNo: string | null; status: string }[]>`
      SELECT s.id, s."vehicleId", v."routeId", s."bcCustomerNo", s.status
      FROM "RouteStop" s JOIN "RouteVehicle" v ON v.id = s."vehicleId"
      WHERE s.id = ${stopId} LIMIT 1
    `
    if (stop.length === 0) throw new Error('Stoppet findes ikke')
    const { routeId, vehicleId: fromVehicleId, bcCustomerNo } = stop[0]

    let target = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM "RouteVehicle" WHERE "routeId" = ${routeId} AND "vehicleLabel" = ${toVehicle} LIMIT 1
    `
    let targetId = target[0]?.id
    if (!targetId) {
      targetId = randomUUID()
      const maxSort = await tx.$queryRaw<{ n: number | null }[]>`
        SELECT MAX("sortOrder") AS n FROM "RouteVehicle" WHERE "routeId" = ${routeId}
      `
      await tx.$executeRaw`
        INSERT INTO "RouteVehicle" (id, "routeId", "vehicleLabel", "driverId", "sortOrder")
        VALUES (${targetId}, ${routeId}, ${toVehicle}, NULL, ${Number(maxSort[0]?.n ?? 0) + 1})
      `
    }
    if (targetId === fromVehicleId) return { moved: false }

    const last = await tx.$queryRaw<{ n: number | null }[]>`
      SELECT MAX("sortOrder") AS n FROM "RouteStop" WHERE "vehicleId" = ${targetId}
    `
    await tx.$executeRaw`
      UPDATE "RouteStop" SET "vehicleId" = ${targetId}, "sortOrder" = ${Number(last[0]?.n ?? -1) + 1}
      WHERE id = ${stopId}
    `
    // Luk hullet i den gamle bil
    const rest = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM "RouteStop" WHERE "vehicleId" = ${fromVehicleId} ORDER BY "sortOrder", "createdAt"
    `
    for (let i = 0; i < rest.length; i++) {
      await tx.$executeRaw`UPDATE "RouteStop" SET "sortOrder" = ${i} WHERE id = ${rest[i].id}`
    }

    if (permanent && bcCustomerNo) {
      await tx.$executeRaw`
        INSERT INTO "CustomerRouteProfile" ("customerNo", "routeOrder", "defaultVehicle", "updatedAt")
        VALUES (${bcCustomerNo}, 5000, ${vehicleNo}, ${now}::timestamp)
        ON CONFLICT ("customerNo") DO UPDATE
          SET "defaultVehicle" = EXCLUDED."defaultVehicle", "updatedAt" = EXCLUDED."updatedAt"
      `
    }
    return { moved: true, vehicleId: targetId }
  })

  return NextResponse.json({ ok: true, ...result })
}
