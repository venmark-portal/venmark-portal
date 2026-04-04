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
    bcOrders = await Promise.race([
      getSalesOrdersForDelivery(params.date, { fetchLines: false }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('BC timeout (15s) — prøv igen')), 15_000)
      ),
    ])
  } catch (err) {
    bcError = err instanceof Error ? err.message : String(err)
    console.error('BC fejl:', bcError)
  }

  let routeRows:   any[] = []
  let driverRows:  any[] = []
  let codeRows:    any[] = []
  let profileRows: any[] = []

  try {
    ;[routeRows, driverRows, codeRows, profileRows] = await Promise.all([
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
        WHERE date(r."bookingDate") = date(${params.date})
        ORDER BY v."sortOrder", s."sortOrder"
      `,
      prisma.$queryRaw<any[]>`
        SELECT id, name, phone, "isDefault"
        FROM "DriverUser" WHERE "isActive" = true ORDER BY "isDefault" DESC, name ASC
      `,
      prisma.$queryRaw<any[]>`SELECT id, code, name FROM "DeliveryCode" ORDER BY code ASC`,
      prisma.$queryRaw<any[]>`SELECT "customerNo", "routeOrder" FROM "CustomerRouteProfile"`,
    ])
  } catch (dbErr) {
    console.error('DB fejl:', dbErr instanceof Error ? dbErr.message : dbErr)
    // Returner hvad vi har — siden kan vise BC-ordrer selv uden gemte ruter
  }

  return NextResponse.json({
    bcOrders,
    bcError,
    routeRows,
    drivers: driverRows.map(d => ({ ...d, isDefault: Boolean(d.isDefault) })),
    deliveryCodes: codeRows,
    routeProfiles: Object.fromEntries(profileRows.map(p => [p.customerNo, Number(p.routeOrder)])),
  })
}
