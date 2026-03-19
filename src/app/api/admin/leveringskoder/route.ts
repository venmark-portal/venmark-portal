import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { randomUUID } from 'crypto'

export const runtime = 'nodejs'

export async function GET() {
  const codes = await prisma.$queryRaw<any[]>`
    SELECT dc.id, dc.code, dc.name, dc.description, dc.createdAt,
      json_group_array(json_object(
        'id', ct.id, 'name', ct.name, 'email', ct.email, 'phone', ct.phone, 'role', ct.role
      )) as contactsJson
    FROM DeliveryCode dc
    LEFT JOIN DeliveryContact ct ON ct.deliveryCodeId = dc.id
    GROUP BY dc.id
    ORDER BY dc.code ASC
  `
  return NextResponse.json(codes.map(c => ({
    ...c,
    contacts: JSON.parse(c.contactsJson).filter((x: any) => x.id !== null),
  })))
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session || (session.user as any)?.role !== 'admin') {
    return new NextResponse('Unauthorized', { status: 401 })
  }
  const { code, name, description, contacts } = await req.json()
  if (!code || !name) return NextResponse.json({ error: 'Kode og navn er påkrævet' }, { status: 400 })

  const id = randomUUID()
  const now = new Date().toISOString()
  await prisma.$executeRaw`
    INSERT INTO DeliveryCode (id, code, name, description, createdAt) VALUES (${id}, ${code.toUpperCase()}, ${name}, ${description ?? null}, ${now})
  `
  if (contacts?.length) {
    for (const c of contacts) {
      await prisma.$executeRaw`
        INSERT INTO DeliveryContact (id, deliveryCodeId, name, email, phone, role)
        VALUES (${randomUUID()}, ${id}, ${c.name}, ${c.email ?? null}, ${c.phone ?? null}, ${c.role ?? 'transporter'})
      `
    }
  }
  return NextResponse.json({ id })
}
