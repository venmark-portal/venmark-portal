import { NextRequest, NextResponse } from 'next/server'
import { getToken } from 'next-auth/jwt'
import { prisma } from '@/lib/prisma'

export const runtime = 'nodejs'

function defaultDate(): string {
  const now = new Date()
  const cphToday = now.toLocaleDateString('sv-SE', { timeZone: 'Europe/Copenhagen' })
  const cphHour  = parseInt(now.toLocaleString('en-US', { timeZone: 'Europe/Copenhagen', hour: '2-digit', hour12: false }))
  if (cphHour >= 15) {
    // Næste hverdag
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

  const routeRows = await prisma.$queryRaw<any[]>`
    SELECT r.id AS "routeId", r.notes AS "routeNotes",
      v.id AS "vehicleId", v."vehicleLabel", v."driverId" AS "vehicleDriverId",
      s.id AS "stopId", s."sortOrder", s."driverId" AS "stopDriverId",
      s."bcSalesOrderNo", s."bcSalesOrderId",
      s."isExtraTask", s."extraTaskTitle", s."extraTaskNote",
      s."customerName", s."customerAddress", s."customerPhone",
      s."totalWeightKg", s.status AS "stopStatus",
      s."deliveredAt", s."failureNote", s."packedStatus"
    FROM "DeliveryRoute" r
    JOIN "RouteVehicle" v ON v."routeId" = r.id
    LEFT JOIN "RouteStop" s ON s."vehicleId" = v.id
    WHERE r."bookingDate"::date = ${date}::date
    ORDER BY v."sortOrder", s."sortOrder"
  `

  if (routeRows.length === 0) {
    return NextResponse.json({ date, vehicles: [], notes: '' })
  }

  // Byg vehicle-struktur — kun biler tildelt denne chauffør
  const vMap = new Map<string, any>()
  for (const r of routeRows) {
    if (!r.vehicleId) continue
    if (r.vehicleDriverId !== driverId) continue

    if (!vMap.has(r.vehicleId)) {
      vMap.set(r.vehicleId, {
        vehicleId:    r.vehicleId,
        vehicleLabel: r.vehicleLabel,
        stops: [],
      })
    }

    // Vis stop hvis stopDriverId er null (arver bilens chauffør) eller matcher
    if (r.stopId && (r.stopDriverId === null || r.stopDriverId === driverId)) {
      vMap.get(r.vehicleId)!.stops.push({
        id:              r.stopId,
        sortOrder:       r.sortOrder,
        bcSalesOrderNo:  r.bcSalesOrderNo,
        bcSalesOrderId:  r.bcSalesOrderId,
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
      })
    }
  }

  return NextResponse.json({
    date,
    notes:    routeRows[0]?.routeNotes ?? '',
    vehicles: Array.from(vMap.values()),
  })
}
