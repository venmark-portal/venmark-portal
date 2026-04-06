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

  const rows = await prisma.$queryRaw<any[]>`
    SELECT
      s.id                   AS "stopId",
      s."bcSalesOrderNo",
      s."customerName",
      s."customerAddress",
      s."deliveryCodeOverride",
      s."totalWeightKg",
      s."deliveredAt",
      s."failureNote",
      s.status,
      v."vehicleLabel",
      r."bookingDate"
    FROM "RouteStop" s
    JOIN "RouteVehicle" v ON v.id = s."vehicleId"
    JOIN "DeliveryRoute" r ON r.id = v."routeId"
    WHERE s.status IN ('DELIVERED', 'FAILED')
      AND (${from}::text   IS NULL OR r."bookingDate"::date >= ${from}::date)
      AND (${to}::text     IS NULL OR r."bookingDate"::date <= ${to}::date)
      AND (${search}::text IS NULL OR lower(s."customerName") LIKE '%' || lower(${search}) || '%')
    ORDER BY s."deliveredAt" DESC NULLS LAST
    LIMIT 500
  `

  return NextResponse.json(rows)
}
