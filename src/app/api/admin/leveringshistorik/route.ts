import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session || (session.user as any)?.role !== 'admin') {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  const url    = new URL(req.url)
  const search = url.searchParams.get('search') || null
  const from   = url.searchParams.get('from')   || null
  const to     = url.searchParams.get('to')     || null

  // Sikr at RouteStopPhoto-tabellen eksisterer
  await prisma.$executeRaw`
    CREATE TABLE IF NOT EXISTS "RouteStopPhoto" (
      id          TEXT PRIMARY KEY,
      "stopId"    TEXT NOT NULL,
      filename    TEXT NOT NULL,
      "takenAt"   TIMESTAMP NOT NULL,
      lat         DOUBLE PRECISION,
      lng         DOUBLE PRECISION,
      "expiresAt" TIMESTAMP NOT NULL
    )
  `

  const rows = await prisma.$queryRaw<any[]>`
    SELECT
      s.id                    AS "stopId",
      s."bcSalesOrderNo",
      s."customerName",
      s."customerAddress",
      s."deliveryCodeOverride",
      s."totalWeightKg",
      s."deliveredAt",
      s."failureNote",
      s.status,
      v."vehicleLabel",
      r."bookingDate",
      p.lat                   AS "photoLat",
      p.lng                   AS "photoLng",
      p."takenAt"             AS "photoTakenAt",
      CASE WHEN p.id IS NOT NULL THEN true ELSE false END AS "hasPhoto"
    FROM "RouteStop" s
    JOIN "RouteVehicle" v ON v.id = s."vehicleId"
    JOIN "DeliveryRoute" r ON r.id = v."routeId"
    LEFT JOIN LATERAL (
      SELECT id, lat, lng, "takenAt" FROM "RouteStopPhoto"
      WHERE "stopId" = s.id
      ORDER BY "takenAt" DESC LIMIT 1
    ) p ON true
    WHERE s.status IN ('DELIVERED', 'FAILED')
      AND (${from}::text   IS NULL OR r."bookingDate"::date >= ${from}::date)
      AND (${to}::text     IS NULL OR r."bookingDate"::date <= ${to}::date)
      AND (${search}::text IS NULL OR lower(s."customerName") LIKE '%' || lower(${search}) || '%')
    ORDER BY s."deliveredAt" DESC NULLS LAST
    LIMIT 100
  `

  return NextResponse.json(rows)
}
