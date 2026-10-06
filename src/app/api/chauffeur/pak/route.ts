import { NextRequest, NextResponse } from 'next/server'
import { getToken } from 'next-auth/jwt'
import { prisma } from '@/lib/prisma'
import { getAccessToken, bcBaseUrl } from '@/lib/businesscentral'
import { ensureRouteSchema, materializeRouteIfMissing } from '@/lib/route-plan-db'

export const runtime = 'nodejs'

function today() {
  return new Date().toISOString().slice(0, 10)
}

// Varenumre der ikke er fysiske varer og derfor ikke skal pakkes:
// 999999 = fragt/ekspedition/gebyr (BC: Salgsopsætning → "Fragt varenummer").
const NON_PACKABLE_ITEMS = new Set(['999999'])

// Hent BC salgslinjer for en ordre (kun Item-linjer, uden gebyr-linjer)
async function fetchBCLines(orderNo: string, headers: Record<string, string>, base: string) {
  const filter = encodeURIComponent(`documentNo eq '${orderNo}' and type eq 'Item'`)
  const url = `${base}/portalSalesLines?$filter=${filter}&$top=200`
  const res = await fetch(url, { headers, cache: 'no-store' })
  if (!res.ok) return []
  const data = await res.json()
  return (data.value ?? []).filter((l: any) => !NON_PACKABLE_ITEMS.has(String(l.lineObjectNumber ?? '').trim()))
}

// GET /api/chauffeur/pak?date=YYYY-MM-DD
export async function GET(req: NextRequest) {
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET })
  if (!token || token.role !== 'driver') {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  const driverId = token.sub as string
  const date = req.nextUrl.searchParams.get('date') ?? today()
  const allVehicles = req.nextUrl.searchParams.get('alle') === '1'

  // Hent chaufførens bcDriverCode til packedBy + standardbil/kode til "Min bil"
  await ensureRouteSchema()
  const driverRows = await prisma.$queryRaw<any[]>`
    SELECT "bcDriverCode", name, "defaultVehicleLabel", "bcShipmentMethodCode"
    FROM "DriverUser" WHERE id = ${driverId} LIMIT 1
  `
  const bcDriverCode = driverRows[0]?.bcDriverCode ?? driverRows[0]?.name ?? 'UKENDT'
  const myVehicle    = driverRows[0]?.defaultVehicleLabel ?? 'Bil 1'
  const myCode       = driverRows[0]?.bcShipmentMethodCode ?? null

  // Ingen gemt rute endnu → dan den automatisk ud fra faste rutenumre (samme som Rute-fanen)
  try { await materializeRouteIfMissing(date) } catch (err) {
    console.error('Auto-rute (pak) fejlede:', err instanceof Error ? err.message : err)
  }

  // Hent KØB*-ordrenumre fra ruteplanen for denne dato.
  // "Min bil" = bilen har mig som chauffør, ELLER hedder som min standardbil, ELLER
  // stoppet har min leveringskode (bilerne gemmes typisk uden chauffør).
  let kobQuery: any[]
  if (allVehicles) {
    kobQuery = await prisma.$queryRaw<any[]>`
      SELECT DISTINCT s."kobSalesOrderNo", s."customerName", s."customerAddress",
        v."vehicleLabel", v."driverId"
      FROM "DeliveryRoute" r
      JOIN "RouteVehicle" v ON v."routeId" = r.id
      JOIN "RouteStop" s ON s."vehicleId" = v.id
      WHERE r."bookingDate"::date = ${date}::date
        AND s."kobSalesOrderNo" IS NOT NULL
      ORDER BY v."vehicleLabel", s."customerName"
    `
  } else {
    kobQuery = await prisma.$queryRaw<any[]>`
      SELECT DISTINCT s."kobSalesOrderNo", s."customerName", s."customerAddress",
        v."vehicleLabel", v."driverId"
      FROM "DeliveryRoute" r
      JOIN "RouteVehicle" v ON v."routeId" = r.id
      JOIN "RouteStop" s ON s."vehicleId" = v.id
      WHERE r."bookingDate"::date = ${date}::date
        AND s."kobSalesOrderNo" IS NOT NULL
        AND (v."driverId" = ${driverId}
          OR v."vehicleLabel" = ${myVehicle}
          OR (${myCode}::text IS NOT NULL AND s."deliveryCodeOverride" = ${myCode}))
      ORDER BY s."customerName"
    `
  }

  if (kobQuery.length === 0) {
    const anyRoute = await prisma.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n FROM "DeliveryRoute" WHERE "bookingDate"::date = ${date}::date
    `
    return NextResponse.json({ date, bcDriverCode, customers: [], noRoute: Number(anyRoute[0]?.n ?? 0) === 0 })
  }

  // Hent BC linjer parallelt for alle KØB*-ordrer
  const bcToken = await getAccessToken()
  const tenant  = process.env.BC_TENANT_ID!
  const env     = process.env.BC_ENVIRONMENT_NAME ?? 'production'
  const company = process.env.BC_COMPANY_ID!
  const base    = `https://api.businesscentral.dynamics.com/v2.0/${tenant}/${env}/api/venmark/portal/v1.0/companies(${company})`
  const headers = { Authorization: `Bearer ${bcToken}`, Accept: 'application/json' }

  const lineResults = await Promise.all(
    kobQuery.map(async row => ({
      orderNo:      row.kobSalesOrderNo,
      customerName: row.customerName,
      address:      row.customerAddress,
      vehicle:      row.vehicleLabel,
      lines:        await fetchBCLines(row.kobSalesOrderNo, headers, base),
    }))
  )

  const customers = lineResults.map(r => ({
    orderNo:      r.orderNo,
    customerName: r.customerName,
    address:      r.address,
    vehicle:      r.vehicle,
    packed:       r.lines.every((l: any) => !!l.packedBy),
    lines:        r.lines.map((l: any) => ({
      id:          l.id,
      lineNo:      l.lineNo,
      itemNo:      l.lineObjectNumber,
      description: l.description,
      quantity:    l.quantity,
      shipQty:     l.shipQuantity ?? l.quantity,
      uom:         l.unitOfMeasureCode,
      packedBy:    l.packedBy ?? '',
    })),
  }))

  return NextResponse.json({ date, bcDriverCode, customers })
}

// PATCH /api/chauffeur/pak  — godkend pakning for én ordre
export async function PATCH(req: NextRequest) {
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET })
  if (!token || token.role !== 'driver') {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  const { lines, bcDriverCode } = await req.json()
  // lines: Array<{ id: string (BC SystemId), shipQty: number }>

  const bcToken = await getAccessToken()
  const tenant  = process.env.BC_TENANT_ID!
  const env     = process.env.BC_ENVIRONMENT_NAME ?? 'production'
  const company = process.env.BC_COMPANY_ID!
  const base    = `https://api.businesscentral.dynamics.com/v2.0/${tenant}/${env}/api/venmark/portal/v1.0/companies(${company})`

  const errors: string[] = []
  await Promise.all(lines.map(async (line: { id: string; shipQty: number }) => {
    const res = await fetch(`${base}/portalSalesLines(${line.id})`, {
      method:  'PATCH',
      headers: {
        Authorization:  `Bearer ${bcToken}`,
        'Content-Type': 'application/json',
        'If-Match':     '*',
      },
      body: JSON.stringify({
        packedBy:     bcDriverCode,
        shipQuantity: line.shipQty,
      }),
    })
    if (!res.ok) {
      const err = await res.text()
      errors.push(`Linje ${line.id}: ${err}`)
    }
  }))

  if (errors.length) return NextResponse.json({ ok: false, errors }, { status: 207 })
  return NextResponse.json({ ok: true })
}
