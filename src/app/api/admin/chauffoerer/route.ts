import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getPortalDrivers } from '@/lib/businesscentral'
import bcrypt from 'bcryptjs'
import { randomUUID } from 'crypto'

export const runtime = 'nodejs'

// GET: Hent lokale DriverUser-rækker (synkroniseret fra BC)
export async function GET() {
  // Sikr at bcDriverCode-kolonnen eksisterer (idempotent migration)
  await prisma.$executeRaw`
    ALTER TABLE "DriverUser" ADD COLUMN IF NOT EXISTS "bcDriverCode" TEXT UNIQUE
  `

  const rows = await prisma.$queryRaw<any[]>`
    SELECT "id", "name", "phone", "email", "isDefault", "isActive",
           "defaultVehicleLabel", "bcDriverCode", "createdAt"
    FROM "DriverUser"
    ORDER BY "isDefault" DESC, "name" ASC
  `
  return NextResponse.json(rows.map(r => ({
    ...r,
    isDefault: Boolean(r.isDefault),
    isActive:  Boolean(r.isActive),
    defaultVehicleLabel: r.defaultVehicleLabel ?? 'Bil 1',
    bcDriverCode: r.bcDriverCode ?? null,
    hasPin: true, // pinHash eksisterer altid når rækken er synkroniseret
  })))
}

// POST: Synkroniser chauffører fra BC → DriverUser-tabellen
// Opretter nye rækker for nye BC-chauffører og opdaterer navn/telefon på eksisterende.
// PIN-koden sættes separat via PUT /[id].
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session || (session.user as any)?.role !== 'admin') {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  // Sikr at bcDriverCode-kolonnen eksisterer
  await prisma.$executeRaw`
    ALTER TABLE "DriverUser" ADD COLUMN IF NOT EXISTS "bcDriverCode" TEXT UNIQUE
  `

  const bcDrivers = await getPortalDrivers()
  if (bcDrivers.length === 0) {
    return NextResponse.json({ synced: 0, message: 'Ingen chauffører fundet i BC — er Portal Driver API deployed?' })
  }

  const now = new Date().toISOString()
  let created = 0
  let updated = 0

  for (const d of bcDrivers) {
    const existing = await prisma.$queryRaw<any[]>`
      SELECT "id" FROM "DriverUser" WHERE "bcDriverCode" = ${d.code} LIMIT 1
    `

    if (existing.length > 0) {
      // Opdater navn og telefon fra BC (kilde til sandhed)
      await prisma.$executeRaw`
        UPDATE "DriverUser"
        SET "name"      = ${d.name},
            "phone"     = ${d.phone || null},
            "isActive"  = ${d.active},
            "updatedAt" = ${now}
        WHERE "bcDriverCode" = ${d.code}
      `
      updated++
    } else {
      // Ny chauffør fra BC — opret med tom PIN (admin skal sætte PIN separat)
      const id = randomUUID()
      // Placeholder pinHash: bcrypt af umulig PIN — chauffør kan ikke logge ind før PIN sættes
      const placeholderHash = await bcrypt.hash(`__UNSET__${id}`, 10)
      await prisma.$executeRaw`
        INSERT INTO "DriverUser"
          ("id", "name", "phone", "email", "pinHash", "isDefault", "isActive",
           "defaultVehicleLabel", "bcDriverCode", "createdAt", "updatedAt")
        VALUES
          (${id}, ${d.name}, ${d.phone || null}, null, ${placeholderHash},
           false, ${d.active}, 'Bil 1', ${d.code}, ${now}, ${now})
        ON CONFLICT ("bcDriverCode") DO NOTHING
      `
      created++
    }
  }

  return NextResponse.json({ synced: bcDrivers.length, created, updated })
}
