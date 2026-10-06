import { NextRequest, NextResponse } from 'next/server'
import { getToken } from 'next-auth/jwt'
import { prisma } from '@/lib/prisma'
import { ensureRouteSchema, materializeRouteIfMissing, loadOwnCodes } from '@/lib/route-plan-db'
import { isOwnRouteCode } from '@/lib/route-plan'

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

  await ensureRouteSchema()

  // Chaufførens standard leveringskode
  const driverRows = await prisma.$queryRaw<any[]>`
    SELECT "bcShipmentMethodCode", "defaultVehicleLabel"
    FROM "DriverUser" WHERE id = ${driverId} LIMIT 1
  `
  const bcDriverCode = driverRows[0]?.bcShipmentMethodCode ?? null
  const driverCode   = alle ? null : bcDriverCode

  // Ingen gemt rute for dagen → dan den automatisk ud fra faste rutenumre/standardbiler.
  // Ruten tæller fra første øjeblik; admin kan stadig rette den bagefter.
  let bcError: string | null = null
  let autoCreated = false
  try {
    autoCreated = await materializeRouteIfMissing(date)
  } catch (err) {
    bcError = err instanceof Error ? err.message : String(err)
    console.error('Auto-rute fejlede:', bcError)
  }

  const routeRows = await prisma.$queryRaw<any[]>`
    SELECT r.id AS "routeId", r.notes AS "routeNotes", r.status AS "routeStatus",
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

  // Koder der vises som faner for chauffører (egen rute)
  const own = await loadOwnCodes()
  const ownCodes = Array.from(own.keys()).filter(c => isOwnRouteCode(c, own)).sort()

  const base = {
    date,
    preliminary: false,
    autoCreated,
    bcError,
    driverCode: bcDriverCode,
    ownCodes,
    routeStatus: routeRows[0]?.routeStatus ?? null,
    notes: routeRows[0]?.routeNotes ?? '',
  }

  if (!routeRows.some(r => r.stopId)) {
    return NextResponse.json({ ...base, vehicles: [] })
  }

  // Filtrer stops på chaufførens leveringskode (deliveryCodeOverride)
  const filtered = driverCode
    ? routeRows.filter(r => !r.stopId || r.deliveryCodeOverride === driverCode || r.deliveryCodeOverride === null)
    : routeRows

  // Hent leveringsprofiler + åbne tickets for unikke kunder
  const customerNos = Array.from(new Set(filtered.map(r => r.bcCustomerNo).filter(Boolean)))
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

  return NextResponse.json({ ...base, vehicles: Array.from(vMap.values()) })
}
