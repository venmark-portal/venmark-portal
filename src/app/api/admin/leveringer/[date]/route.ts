import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getSalesOrdersForDelivery } from '@/lib/businesscentral'


export const runtime = 'nodejs'

export async function GET(
  _req: NextRequest,
  { params }: { params: { date: string } }
) {
  const session = await getServerSession(authOptions)
  if (!session || (session.user as any)?.role !== 'admin') {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  let bcOrders: any[] = []
  let bcError: string | null = null
  try {
    bcOrders = await getSalesOrdersForDelivery(params.date)
  } catch (err) {
    bcError = err instanceof Error ? err.message : String(err)
    console.error('BC fejl:', bcError)
  }

  const [routeRows, driverRows, codeRows] = await Promise.all([
    prisma.$queryRaw<any[]>`
      SELECT r.id as "routeId", r.status as "routeStatus", r.notes as "routeNotes",
        v.id as "vehicleId", v."vehicleLabel", v."driverId", v."sortOrder" as "vehicleSortOrder",
        s.id as "stopId", s."sortOrder", s."driverId" as "stopDriverId",
        s."bcSalesOrderNo", s."bcSalesOrderId", s."bcPurchaseOrderNo", s."bcPurchaseOrderId",
        s."isExtraTask", s."extraTaskTitle", s."extraTaskNote",
        s."customerName", s."customerAddress", s."customerPhone", s."totalWeightKg",
        s.status as "stopStatus", s."deliveryCodeId", s."deliveryCodeOverride", s."packedStatus"
      FROM "DeliveryRoute" r
      JOIN "RouteVehicle" v ON v."routeId" = r.id
      LEFT JOIN "RouteStop" s ON s."vehicleId" = v.id
      WHERE date(r."bookingDate") = ${params.date}::date
      ORDER BY v."sortOrder", s."sortOrder"
    `,
    prisma.$queryRaw<any[]>`
      SELECT id, name, phone, "isDefault", "defaultVehicleLabel"
      FROM "DriverUser" WHERE "isActive" = true ORDER BY "isDefault" DESC, name ASC
    `,
    prisma.$queryRaw<any[]>`SELECT id, code, name FROM "DeliveryCode" ORDER BY code ASC`,
  ])

  return NextResponse.json({
    bcOrders,
    bcError,
    routeRows,
    drivers: (driverRows as any[]).map(d => ({
      ...d,
      isDefault: Boolean(d.isDefault),
      defaultVehicleLabel: d.defaultVehicleLabel ?? 'Bil 1',
    })),
    deliveryCodes: codeRows,
  })
}
