import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { randomUUID } from 'crypto'

export const runtime = 'nodejs'

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session || (session.user as any)?.role !== 'admin') return new NextResponse('Unauthorized', { status: 401 })

  const { code, name, description, contacts } = await req.json()
  await prisma.$executeRaw`
    UPDATE DeliveryCode SET code=${code.toUpperCase()}, name=${name}, description=${description ?? null} WHERE id=${params.id}
  `
  // Erstat alle kontakter
  await prisma.$executeRaw`DELETE FROM DeliveryContact WHERE deliveryCodeId=${params.id}`
  if (contacts?.length) {
    for (const c of contacts) {
      await prisma.$executeRaw`
        INSERT INTO DeliveryContact (id, deliveryCodeId, name, email, phone, role)
        VALUES (${randomUUID()}, ${params.id}, ${c.name}, ${c.email ?? null}, ${c.phone ?? null}, ${c.role ?? 'transporter'})
      `
    }
  }
  return NextResponse.json({ ok: true })
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session || (session.user as any)?.role !== 'admin') return new NextResponse('Unauthorized', { status: 401 })
  await prisma.$executeRaw`DELETE FROM DeliveryCode WHERE id=${params.id}`
  return NextResponse.json({ ok: true })
}
