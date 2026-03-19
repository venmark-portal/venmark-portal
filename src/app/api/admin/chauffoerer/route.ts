import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import bcrypt from 'bcryptjs'
import { randomUUID } from 'crypto'

export const runtime = 'nodejs'

function adminOnly(session: any) {
  return session && (session.user as any)?.role === 'admin'
}

export async function GET() {
  const rows = await prisma.$queryRaw<any[]>`
    SELECT id, name, phone, email, isDefault, isActive, defaultVehicleLabel, createdAt
    FROM DriverUser ORDER BY isDefault DESC, name ASC
  `
  return NextResponse.json(rows.map(r => ({
    ...r,
    isDefault: Boolean(r.isDefault),
    isActive:  Boolean(r.isActive),
    defaultVehicleLabel: r.defaultVehicleLabel ?? 'Bil 1',
  })))
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!adminOnly(session)) return new NextResponse('Unauthorized', { status: 401 })

  const { name, phone, email, pin, isDefault, defaultVehicleLabel } = await req.json()
  if (!name || !pin || pin.length < 4) {
    return NextResponse.json({ error: 'Navn og PIN (min 4 cifre) er påkrævet' }, { status: 400 })
  }

  const pinHash = await bcrypt.hash(pin, 10)
  const id  = randomUUID()
  const now = new Date().toISOString()
  const vLabel = defaultVehicleLabel || 'Bil 1'

  await prisma.$executeRaw`
    INSERT INTO DriverUser (id, name, phone, email, pinHash, isDefault, isActive, defaultVehicleLabel, createdAt, updatedAt)
    VALUES (${id}, ${name}, ${phone ?? null}, ${email ?? null}, ${pinHash}, ${isDefault ? 1 : 0}, 1, ${vLabel}, ${now}, ${now})
  `
  return NextResponse.json({ id, name, phone, email, isDefault: Boolean(isDefault), isActive: true, defaultVehicleLabel: vLabel })
}
