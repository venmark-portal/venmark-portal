import { NextRequest, NextResponse } from 'next/server'
import { getToken } from 'next-auth/jwt'
import { prisma } from '@/lib/prisma'
import { writeFile, mkdir } from 'fs/promises'
import { sendPod } from '@/lib/pod'
import path from 'path'

export const runtime = 'nodejs'

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET })
  if (!token || token.role !== 'driver') {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  const formData = await req.formData()
  const photo = formData.get('photo') as File | null
  const lat   = parseFloat(formData.get('lat') as string || '0') || null
  const lng   = parseFloat(formData.get('lng') as string || '0') || null

  if (!photo) return NextResponse.json({ error: 'Intet foto' }, { status: 400 })

  const stopId  = params.id
  const now     = new Date()
  const dateStr = now.toISOString().slice(0, 10)
  const filename = `${stopId}_${Date.now()}.jpg`
  const dir = path.join(process.cwd(), 'uploads', 'delivery-photos', dateStr)

  await mkdir(dir, { recursive: true })
  const buffer = Buffer.from(await photo.arrayBuffer())
  await writeFile(path.join(dir, filename), buffer)

  const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)

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
  await prisma.$executeRaw`ALTER TABLE "RouteStopPhoto" ADD COLUMN IF NOT EXISTS lat DOUBLE PRECISION`
  await prisma.$executeRaw`ALTER TABLE "RouteStopPhoto" ADD COLUMN IF NOT EXISTS lng DOUBLE PRECISION`

  const photoId = crypto.randomUUID()
  await prisma.$executeRaw`
    INSERT INTO "RouteStopPhoto" (id, "stopId", filename, "takenAt", lat, lng, "expiresAt")
    VALUES (${photoId}, ${stopId}, ${dateStr + '/' + filename}, ${now}, ${lat}, ${lng}, ${expiresAt})
  `

  await prisma.$executeRaw`
    UPDATE "RouteStop" SET status = 'DELIVERED', "deliveredAt" = ${now} WHERE id = ${stopId}
  `

  // Hent stop-info til POD
  const stopRows = await prisma.$queryRaw<any[]>`
    SELECT s."customerName", s."bcSalesOrderNo",
           v."vehicleLabel", r."bookingDate"
    FROM "RouteStop" s
    JOIN "RouteVehicle" v ON v.id = s."vehicleId"
    JOIN "DeliveryRoute" r ON r.id = v."routeId"
    WHERE s.id = ${stopId}
    LIMIT 1
  `
  const stop = stopRows[0]

  // Hent POD-modtagere for denne kunde (fra PodRecipient-tabel)
  let recipients: any[] = []
  try {
    await prisma.$executeRaw`
      CREATE TABLE IF NOT EXISTS "PodRecipient" (
        id               TEXT PRIMARY KEY,
        "bcCustomerNo"   TEXT NOT NULL,
        name             TEXT,
        email            TEXT,
        phone            TEXT,
        "sendEmail"      BOOLEAN NOT NULL DEFAULT false,
        "sendSms"        BOOLEAN NOT NULL DEFAULT false,
        "sortOrder"      INTEGER NOT NULL DEFAULT 0
      )
    `
    // Find kundenummer via bcSalesOrderNo → Customer tabel
    const custRows = await prisma.$queryRaw<any[]>`
      SELECT c."bcCustomerNumber"
      FROM "Customer" c
      JOIN "RouteStop" s ON s."customerName" = c.name
      WHERE s.id = ${stopId}
      LIMIT 1
    `
    if (custRows[0]?.bcCustomerNumber) {
      recipients = await prisma.$queryRaw<any[]>`
        SELECT email, phone, "sendEmail", "sendSms"
        FROM "PodRecipient"
        WHERE "bcCustomerNo" = ${custRows[0].bcCustomerNumber}
      `
    }
  } catch {}

  // Send POD asynkront (blokker ikke svaret)
  if (stop) {
    sendPod({
      stopId,
      customerName: stop.customerName ?? 'Kunde',
      deliveredAt:  now,
      recipients,
    }).catch(e => console.error('[POD] Fejl:', e))
  }

  return NextResponse.json({ ok: true, photoId })
}

// Hent foto (chauffør + admin)
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET })
  if (!token) return new NextResponse('Unauthorized', { status: 401 })

  const rows = await prisma.$queryRaw<any[]>`
    SELECT filename, "takenAt", lat, lng FROM "RouteStopPhoto"
    WHERE "stopId" = ${params.id}
    ORDER BY "takenAt" DESC LIMIT 1
  `
  if (!rows.length) return NextResponse.json(null)

  const { filename, takenAt, lat, lng } = rows[0]
  const filePath = path.join(process.cwd(), 'uploads', 'delivery-photos', filename)

  const { readFile } = await import('fs/promises')
  try {
    const buf = await readFile(filePath)
    return new NextResponse(buf, {
      headers: {
        'Content-Type':  'image/jpeg',
        'Cache-Control': 'private, max-age=86400',
        'X-Taken-At':    String(takenAt ?? ''),
        'X-Lat':         String(lat ?? ''),
        'X-Lng':         String(lng ?? ''),
      },
    })
  } catch {
    return NextResponse.json(null)
  }
}
