import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import bcrypt from 'bcryptjs'
import { updatePortalDriver } from '@/lib/businesscentral'

export const runtime = 'nodejs'

function adminOnly(session: any) {
  return session && (session.user as any)?.role === 'admin'
}

// PUT: Opdater lokale præferencer + evt. ny PIN
// Navn/telefon styres i BC — her kun: pin, isDefault, defaultVehicleLabel
export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!adminOnly(session)) return new NextResponse('Unauthorized', { status: 401 })

  const { pin, isDefault, defaultVehicleLabel } = await req.json()
  const now    = new Date().toISOString()
  const vLabel = defaultVehicleLabel || 'Bil 1'

  try {
  // PIN + standardbil styres begge steder: skriv til BC FØRST, ellers overskriver næste
  // "Sync fra BC" det der lige er gemt her. Chauffører uden BC-kode findes kun i portalen.
  const rk = await prisma.$queryRaw<{ bcDriverCode: string | null }[]>`
    SELECT "bcDriverCode" FROM "DriverUser" WHERE "id" = ${params.id} LIMIT 1
  `
  const bcCode = rk[0]?.bcDriverCode
  if (bcCode) {
    const vNr = Number(/(\d+)/.exec(vLabel)?.[1] ?? 1)
    await updatePortalDriver(bcCode, {
      defaultVehicle: vNr,
      ...(pin && String(pin).length >= 4 ? { pinCode: String(pin) } : {}),
    })
  }
  if (pin && pin.length >= 4) {
    const pinHash = await bcrypt.hash(String(pin), 10)
    await prisma.$executeRaw`
      UPDATE "DriverUser"
      SET "pinHash"             = ${pinHash},
          "isDefault"           = ${Boolean(isDefault)},
          "defaultVehicleLabel" = ${vLabel},
          "updatedAt"           = ${now}::timestamp
      WHERE "id" = ${params.id}
    `
  } else {
    await prisma.$executeRaw`
      UPDATE "DriverUser"
      SET "isDefault"           = ${Boolean(isDefault)},
          "defaultVehicleLabel" = ${vLabel},
          "updatedAt"           = ${now}::timestamp
      WHERE "id" = ${params.id}
    `
  }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error(`[chauffoer] gem ${params.id} fejlede:`, msg)
    return new NextResponse(msg.slice(0, 200), { status: 500 })
  }

  return NextResponse.json({ ok: true })
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!adminOnly(session)) return new NextResponse('Unauthorized', { status: 401 })
  await prisma.$executeRaw`DELETE FROM "DriverUser" WHERE "id" = ${params.id}`
  return NextResponse.json({ ok: true })
}
