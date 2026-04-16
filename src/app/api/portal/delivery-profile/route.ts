import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { randomUUID } from 'crypto'

// ── GET: hent eksisterende leveringsprofil ────────────────────────────────────
export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Ikke logget ind' }, { status: 401 })
  const customerId = (session.user as any)?.id as string

  const profiles = await prisma.$queryRaw<any[]>`
    SELECT * FROM "DeliveryProfile" WHERE "customerId" = ${customerId} LIMIT 1
  `
  const profile = profiles[0]
  if (!profile) return NextResponse.json({})

  const photos = await prisma.$queryRaw<any[]>`
    SELECT * FROM "DeliveryPhoto" WHERE "profileId" = ${profile.id} ORDER BY "sortOrder" ASC
  `

  return NextResponse.json({ ...profile, photos })
}

// ── PUT: gem/opdater leveringsprofil ──────────────────────────────────────────
export async function PUT(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Ikke logget ind' }, { status: 401 })
  const customerId = (session.user as any)?.id as string

  const { doorCode, keyboxCode, alarmCode, deliveryDescription, driverMessage, photos } =
    await req.json()

  const existing = await prisma.$queryRaw<any[]>`
    SELECT id FROM "DeliveryProfile" WHERE "customerId" = ${customerId} LIMIT 1
  `

  let profileId: string
  const now = new Date().toISOString()

  if (existing[0]) {
    profileId = existing[0].id
    await prisma.$executeRaw`
      UPDATE "DeliveryProfile"
      SET "doorCode"            = ${doorCode ?? null},
          "keyboxCode"          = ${keyboxCode ?? null},
          "alarmCode"           = ${alarmCode ?? null},
          "deliveryDescription" = ${deliveryDescription ?? null},
          "driverMessage"       = ${driverMessage ?? null},
          "updatedAt"           = ${now}
      WHERE id = ${profileId}
    `
  } else {
    profileId = randomUUID()
    await prisma.$executeRaw`
      INSERT INTO "DeliveryProfile" (id, "customerId", "doorCode", "keyboxCode", "alarmCode", "deliveryDescription", "driverMessage", "updatedAt")
      VALUES (${profileId}, ${customerId}, ${doorCode ?? null}, ${keyboxCode ?? null}, ${alarmCode ?? null}, ${deliveryDescription ?? null}, ${driverMessage ?? null}, ${now})
    `
  }

  if (Array.isArray(photos)) {
    await prisma.$executeRaw`DELETE FROM "DeliveryPhoto" WHERE "profileId" = ${profileId}`
    for (let i = 0; i < Math.min(photos.length, 3); i++) {
      const p = photos[i]
      const photoId = randomUUID()
      await prisma.$executeRaw`
        INSERT INTO "DeliveryPhoto" (id, "profileId", data, "mimeType", "fileName", "sortOrder")
        VALUES (${photoId}, ${profileId}, ${p.data}, ${p.mimeType}, ${p.fileName}, ${i})
      `
    }
  }

  return NextResponse.json({ ok: true })
}
