import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import bcrypt from 'bcryptjs'

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

  if (pin && pin.length >= 4) {
    const pinHash = await bcrypt.hash(pin, 10)
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

  return NextResponse.json({ ok: true })
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!adminOnly(session)) return new NextResponse('Unauthorized', { status: 401 })
  await prisma.$executeRaw`DELETE FROM "DriverUser" WHERE "id" = ${params.id}`
  return NextResponse.json({ ok: true })
}
