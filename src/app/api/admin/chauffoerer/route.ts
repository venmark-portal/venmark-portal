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
  // Sikr at kolonnerne eksisterer (idempotent migration)
  await prisma.$executeRaw`
    ALTER TABLE "DriverUser" ADD COLUMN IF NOT EXISTS "bcDriverCode" TEXT UNIQUE
  `
  await prisma.$executeRaw`
    ALTER TABLE "DriverUser" ADD COLUMN IF NOT EXISTS "bcShipmentMethodCode" TEXT
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

  // Sikr at kolonnerne eksisterer
  await prisma.$executeRaw`
    ALTER TABLE "DriverUser" ADD COLUMN IF NOT EXISTS "bcDriverCode" TEXT UNIQUE
  `
  await prisma.$executeRaw`
    ALTER TABLE "DriverUser" ADD COLUMN IF NOT EXISTS "bcShipmentMethodCode" TEXT
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
      // Opdater navn/telefon/aktiv — men rør IKKE pinHash (sat af admin)
      // Kun hvis BC har en pinCode, overskrives den
      const vLabel = d.defaultVehicle > 0 ? `Bil ${d.defaultVehicle}` : 'Bil 1'
      const smc    = d.defaultShipmentMethodCode || null
      if (d.pinCode) {
        const pinHash = await bcrypt.hash(d.pinCode, 10)
        await prisma.$executeRaw`
          UPDATE "DriverUser"
          SET "name"                   = ${d.name},
              "phone"                  = ${d.phone || null},
              "isActive"               = ${d.active},
              "pinHash"                = ${pinHash},
              "defaultVehicleLabel"    = ${vLabel},
              "bcShipmentMethodCode"   = ${smc},
              "updatedAt"              = ${now}::timestamp
          WHERE "bcDriverCode" = ${d.code}
        `
      } else {
        await prisma.$executeRaw`
          UPDATE "DriverUser"
          SET "name"                   = ${d.name},
              "phone"                  = ${d.phone || null},
              "isActive"               = ${d.active},
              "defaultVehicleLabel"    = ${vLabel},
              "bcShipmentMethodCode"   = ${smc},
              "updatedAt"              = ${now}::timestamp
          WHERE "bcDriverCode" = ${d.code}
        `
      }
      updated++
    } else {
      // Ny chauffør — sæt placeholder PIN (admin sætter den rigtige bagefter)
      const pinHash = d.pinCode
        ? await bcrypt.hash(d.pinCode, 10)
        : await bcrypt.hash(`__UNSET__${randomUUID()}`, 10)
      const id = randomUUID()
      await prisma.$executeRaw`
        INSERT INTO "DriverUser"
          ("id", "name", "phone", "email", "pinHash", "isDefault", "isActive",
           "defaultVehicleLabel", "bcDriverCode", "createdAt", "updatedAt")
        VALUES
          (${id}, ${d.name}, ${d.phone || null}, null, ${pinHash},
           false, ${d.active}, 'Bil 1', ${d.code}, ${now}::timestamp, ${now}::timestamp)
        ON CONFLICT ("bcDriverCode") DO NOTHING
      `
      created++
    }
  }

  return NextResponse.json({ synced: bcDrivers.length, created, updated })
}
