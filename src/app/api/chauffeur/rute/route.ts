import { NextRequest, NextResponse } from 'next/server'
import { getToken } from 'next-auth/jwt'
import { prisma } from '@/lib/prisma'
import { getSalesOrdersForDelivery } from '@/lib/businesscentral'

export const runtime = 'nodejs'

function defaultDate(): string {
  const now = new Date()
  const cphToday = now.toLocaleDateString('sv-SE', { timeZone: 'Europe/Copenhagen' })
  const cphHour  = parseInt(now.toLocaleString('en-US', { timeZone: 'Europe/Copenhagen', hour: '2-digit', hour12: false }))
  if (cphHour >= 15) {
    const d = new Date(cphToday + 'T12:00:00')
    do { d.setDate(d.getDate() + 1) } while (d.getDay() === 0 || d.getDay() === 6)
    return d.toISOString().slice(0, 10)
  }
  return cphToday
}

export async function GET(req: NextRequest) {
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET })
  if (!token || token.role !== 'driver') {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  const driverId = token.sub as string
  const url  = new URL(req.url)
  const date = url.searchParams.get('date') ?? defaultDate()
  const alle = url.searchParams.get('alle') === '1'

  // Hent chaufførens standard leveringskode + bil
  await prisma.$executeRaw`
    ALTER TABLE "DriverUser" ADD COLUMN IF NOT EXISTS "bcShipmentMethodCode" TEXT
  `
  const driverRows = await prisma.$queryRaw<any[]>`
    SELECT "bcShipmentMethodCode", "defaultVehicleLabel"
    FROM "DriverUser" WHERE id = ${driverId} LIMIT 1
  `
  const driverCode    = alle ? null : (driverRows[0]?.bcShipmentMethodCode ?? null)
  const driverVehicle = driverRows[0]?.defaultVehicleLabel ?? 'Bil 1'

  // Sikr kolonnen eksisterer (kan mangle på ældre rækker)
  await prisma.$executeRaw`ALTER TABLE "RouteStop" ADD COLUMN IF NOT EXISTS "bcCustomerNo" TEXT`

  // Hent gemte rutestop fra DB
  const routeRows = await prisma.$queryRaw<any[]>`
    SELECT r.id AS "routeId", r.notes AS "routeNotes",
      v.id AS "vehicleId", v."vehicleLabel", v."driverId" AS "vehicleDriverId",
      s.id AS "stopId", s."sortOrder", s."driverId" AS "stopDriverId",
      s."bcSalesOrderNo", s."bcSalesOrderId",
      s."isExtraTask", s."extraTaskTitle", s."extraTaskNote",
      s."customerName", s."customerAddress", s."customerPhone",
      s."totalWeightKg", s.status AS "stopStatus",
      s."deliveredAt", s."failureNote", s."packedStatus",
      s."deliveryCodeOverride", s."bcCustomerNo"
    FROM "DeliveryRoute" r
    JOIN "RouteVehicle" v ON v."routeId" = r.id
    LEFT JOIN "RouteStop" s ON s."vehicleId" = v.id
    WHERE r."bookingDate"::date = ${date}::date
    ORDER BY v."sortOrder", s."sortOrder"
  `

  // Hvis gemt rute har stops — brug dem
  const hasStops = routeRows.some(r => r.stopId)
  if (hasStops) {
    // Filtrer stops på chaufførens leveringskode (deliveryCodeOverride)
    const filtered = driverCode
      ? routeRows.filter(r => !r.stopId || r.deliveryCodeOverride === driverCode || r.deliveryCodeOverride === null)
      : routeRows

    // Hent leveringsprofiler + åbne tickets for unikke kunder
    const customerNos = [...new Set(filtered.map(r => r.bcCustomerNo).filter(Boolean))]
    const profileMap  = new Map<string, any>()
    const ticketMap   = new Map<string, any[]>()

    if (customerNos.length > 0) {
      const placeholders = customerNos.map((_, i) => `$${i + 1}`).join(', ')
      const profileRows = await prisma.$queryRawUnsafe<any[]>(
        `SELECT c."bcCustomerNumber",
          dp."doorCode", dp."keyboxCode", dp."alarmCode", dp."deliveryDescription"
        FROM "Customer" c
        JOIN "DeliveryProfile" dp ON dp."customerId" = c.id
        WHERE c."bcCustomerNumber" IN (${placeholders})`,
        ...customerNos
      )
      for (const p of profileRows) profileMap.set(p.bcCustomerNumber, p)

      const ticketRows = await prisma.$queryRawUnsafe<any[]>(
        `SELECT c."bcCustomerNumber", t.id, t.subject, t.body, t."createdAt", t.status
        FROM "Customer" c
        JOIN "Ticket" t ON t."customerId" = c.id
        WHERE c."bcCustomerNumber" IN (${placeholders})
          AND t.status IN ('OPEN', 'IN_PROGRESS')
          AND t.type = 'COMPLAINT'
        ORDER BY t."createdAt" DESC`,
        ...customerNos
      )
      for (const t of ticketRows) {
        if (!ticketMap.has(t.bcCustomerNumber)) ticketMap.set(t.bcCustomerNumber, [])
        ticketMap.get(t.bcCustomerNumber)!.push({
          id: t.id, subject: t.subject, body: t.body, createdAt: t.createdAt, status: t.status,
        })
      }
    }

    const vMap = new Map<string, any>()
    for (const r of filtered) {
      if (!r.vehicleId) continue
      if (!vMap.has(r.vehicleId)) {
        vMap.set(r.vehicleId, { vehicleId: r.vehicleId, vehicleLabel: r.vehicleLabel, stops: [] })
      }
      if (r.stopId) {
        const profile = r.bcCustomerNo ? profileMap.get(r.bcCustomerNo) : null
        const tickets = r.bcCustomerNo ? (ticketMap.get(r.bcCustomerNo) ?? []) : []
        vMap.get(r.vehicleId)!.stops.push({
          id:              r.stopId,
          sortOrder:       r.sortOrder,
          bcSalesOrderNo:  r.bcSalesOrderNo,
          deliveryCode:    r.deliveryCodeOverride ?? null,
          isExtraTask:     Boolean(r.isExtraTask),
          extraTaskTitle:  r.extraTaskTitle,
          extraTaskNote:   r.extraTaskNote,
          customerName:    r.customerName,
          customerAddress: r.customerAddress,
          customerPhone:   r.customerPhone,
          totalWeightKg:   r.totalWeightKg,
          status:          r.stopStatus ?? 'PENDING',
          deliveredAt:     r.deliveredAt,
          failureNote:     r.failureNote,
          packedStatus:    r.packedStatus,
          deliveryProfile: profile ? {
            doorCode:            profile.doorCode,
            keyboxCode:          profile.keyboxCode,
            alarmCode:           profile.alarmCode,
            deliveryDescription: profile.deliveryDescription,
          } : null,
          openTickets: tickets,
        })
      }
    }
    return NextResponse.json({
      date,
      preliminary: false,
      driverCode: driverRows[0]?.bcShipmentMethodCode ?? null,
      notes:    routeRows[0]?.routeNotes ?? '',
      vehicles: Array.from(vMap.values()),
    })
  }

  // Ingen gemte stops — hent alle BC-ordrer og vis som foreløbig rute
  try {
    const allOrders = await getSalesOrdersForDelivery(date, { fetchLines: false })
    const bcDriverCode = driverRows[0]?.bcShipmentMethodCode ?? null

    if (allOrders.length === 0) {
      return NextResponse.json({ date, preliminary: true, vehicles: [], notes: '', driverCode: bcDriverCode })
    }

    // Grupper efter leveringskode → vehicle
    const groupMap = new Map<string, any[]>()
    for (const o of allOrders) {
      const code = o.deliveryCodes[0] ?? 'VENMARK'
      if (!groupMap.has(code)) groupMap.set(code, [])
      groupMap.get(code)!.push(o)
    }

    const vehicles = Array.from(groupMap.entries()).map(([code, orders]) => ({
      vehicleId:    `bc-${code}`,
      vehicleLabel: code,
      stops: orders.map((o, i) => ({
        id:              `bc-${o.id}`,
        sortOrder:       i,
        bcSalesOrderNo:  o.number,
        deliveryCode:    code,
        isExtraTask:     false,
        extraTaskTitle:  null,
        extraTaskNote:   null,
        customerName:    o.customerName,
        customerAddress: [o.shipToAddress, o.shipToCity].filter(Boolean).join(', '),
        customerPhone:   o.shipToPhone ?? null,
        totalWeightKg:   o.totalWeightKg,
        status:          'PENDING' as const,
        deliveredAt:     null,
        failureNote:     null,
        packedStatus:    null,
      })),
    }))

    return NextResponse.json({ date, preliminary: true, notes: '', driverCode: bcDriverCode, vehicles })
  } catch {
    return NextResponse.json({ date, preliminary: true, vehicles: [], notes: '', driverCode: null })
  }
}
