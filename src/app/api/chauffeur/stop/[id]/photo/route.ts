import { NextRequest, NextResponse } from 'next/server'
import { getToken } from 'next-auth/jwt'
import { prisma } from '@/lib/prisma'
import { writeFile, mkdir } from 'fs/promises'
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
  const lat   = parseFloat(formData.get('lat') as string || '0')
  const lng   = parseFloat(formData.get('lng') as string || '0')

  if (!photo) return NextResponse.json({ error: 'Intet foto' }, { status: 400 })

  const stopId = params.id
  const now    = new Date()
  const dateStr = now.toISOString().slice(0, 10)
  const filename = `${stopId}_${Date.now()}.jpg`
  const dir = path.join(process.cwd(), 'uploads', 'delivery-photos', dateStr)

  await mkdir(dir, { recursive: true })
  const buffer = Buffer.from(await photo.arrayBuffer())
  await writeFile(path.join(dir, filename), buffer)

  const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)

  // Gem metadata i DB (opret tabel hvis ikke eksisterer)
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
  const id = crypto.randomUUID()
  await prisma.$executeRaw`
    INSERT INTO "RouteStopPhoto" (id, "stopId", filename, "takenAt", lat, lng, "expiresAt")
    VALUES (${id}, ${stopId}, ${dateStr + '/' + filename}, ${now.toISOString()}::timestamp,
            ${lat || null}, ${lng || null}, ${expiresAt.toISOString()}::timestamp)
  `

  // Opdater stop med leveret + foto-flag
  await prisma.$executeRaw`
    UPDATE "RouteStop"
    SET status = 'DELIVERED', "deliveredAt" = ${now.toISOString()}::timestamp
    WHERE id = ${stopId}
  `

  return NextResponse.json({ ok: true, photoId: id })
}

// Hent foto (kun chauffør/admin)
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
        'Content-Type': 'image/jpeg',
        'X-Taken-At': takenAt,
        'X-Lat': String(lat ?? ''),
        'X-Lng': String(lng ?? ''),
      }
    })
  } catch {
    return NextResponse.json(null)
  }
}
