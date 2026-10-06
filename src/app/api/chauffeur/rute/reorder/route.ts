import { NextRequest, NextResponse } from 'next/server'
import { getToken } from 'next-auth/jwt'
import { prisma } from '@/lib/prisma'
import { applyOrder } from '@/lib/route-plan'

export const runtime = 'nodejs'

/**
 * POST /api/chauffeur/rute/reorder  { vehicleId, orderedStopIds }
 * Chaufføren har trukket et stop til en ny plads. Den nye rækkefølge gemmes
 * (1) på dagens rute (RouteStop.sortOrder) og
 * (2) som kundernes faste rutenummer (CustomerRouteProfile.routeOrder, i trin af 10
 *     inden for leveringskoden — samme som admin-sidens træk-og-slip).
 */
export async function POST(req: NextRequest) {
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET })
  if (!token || token.role !== 'driver') {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  const { vehicleId, orderedStopIds } = await req.json() as { vehicleId?: string; orderedStopIds?: string[] }
  if (!vehicleId || !Array.isArray(orderedStopIds) || orderedStopIds.length === 0) {
    return NextResponse.json({ error: 'vehicleId og orderedStopIds kræves' }, { status: 400 })
  }

  const now = new Date().toISOString()

  await prisma.$transaction(async tx => {
    const stops = await tx.$queryRaw<{ id: string; bcCustomerNo: string | null; deliveryCodeOverride: string | null; isExtraTask: boolean }[]>`
      SELECT id, "bcCustomerNo", "deliveryCodeOverride", "isExtraTask"
      FROM "RouteStop" WHERE "vehicleId" = ${vehicleId}
      ORDER BY "sortOrder", "createdAt"
    `
    const known = new Set(stops.map(s => s.id))
    if (!orderedStopIds.every(id => known.has(id))) {
      throw new Error('Et eller flere stop hører ikke til bilen')
    }

    const reordered = applyOrder(stops, orderedStopIds)
    for (let i = 0; i < reordered.length; i++) {
      await tx.$executeRaw`UPDATE "RouteStop" SET "sortOrder" = ${i} WHERE id = ${reordered[i].id}`
    }

    // Faste rutenumre: pr. leveringskode i bilen, 10, 20, 30 …
    const perCode = new Map<string, number>()
    for (const s of reordered) {
      if (s.isExtraTask || !s.bcCustomerNo) continue
      const code = s.deliveryCodeOverride ?? ''
      const n = (perCode.get(code) ?? 0) + 1
      perCode.set(code, n)
      await tx.$executeRaw`
        INSERT INTO "CustomerRouteProfile" ("customerNo", "routeOrder", "defaultVehicle", "updatedAt")
        VALUES (${s.bcCustomerNo}, ${n * 10}, 0, ${now}::timestamp)
        ON CONFLICT ("customerNo") DO UPDATE
          SET "routeOrder" = EXCLUDED."routeOrder",
              "updatedAt"  = EXCLUDED."updatedAt"
      `
    }
  })

  return NextResponse.json({ ok: true })
}
