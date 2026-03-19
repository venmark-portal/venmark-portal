import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import bcrypt from 'bcryptjs'

export const runtime = 'nodejs'

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session || (session.user as any)?.role !== 'admin') {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  const { name, phone, email, pin, isDefault, isActive, defaultVehicleLabel } = await req.json()
  const now    = new Date().toISOString()
  const vLabel = defaultVehicleLabel || 'Bil 1'

  if (pin && pin.length >= 4) {
    const pinHash = await bcrypt.hash(pin, 10)
    await prisma.$executeRaw`
      UPDATE DriverUser SET name=${name}, phone=${phone ?? null}, email=${email ?? null},
        pinHash=${pinHash}, isDefault=${isDefault ? 1 : 0}, isActive=${isActive ? 1 : 0},
        defaultVehicleLabel=${vLabel}, updatedAt=${now}
      WHERE id=${params.id}
    `
  } else {
    await prisma.$executeRaw`
      UPDATE DriverUser SET name=${name}, phone=${phone ?? null}, email=${email ?? null},
        isDefault=${isDefault ? 1 : 0}, isActive=${isActive ? 1 : 0},
        defaultVehicleLabel=${vLabel}, updatedAt=${now}
      WHERE id=${params.id}
    `
  }

  return NextResponse.json({ ok: true })
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session || (session.user as any)?.role !== 'admin') {
    return new NextResponse('Unauthorized', { status: 401 })
  }
  await prisma.$executeRaw`DELETE FROM DriverUser WHERE id=${params.id}`
  return NextResponse.json({ ok: true })
}
