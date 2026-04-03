import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getShipmentMethods } from '@/lib/businesscentral'
import { randomUUID } from 'crypto'

export const runtime = 'nodejs'

export async function GET() {
  const codes = await prisma.$queryRaw<any[]>`
    SELECT dc.id, dc.code, dc.name, dc.description, dc."createdAt",
      COALESCE(
        json_agg(
          json_build_object(
            'id', ct.id, 'name', ct.name, 'email', ct.email, 'phone', ct.phone, 'role', ct.role
          )
        ) FILTER (WHERE ct.id IS NOT NULL),
        '[]'
      ) AS contacts
    FROM "DeliveryCode" dc
    LEFT JOIN "DeliveryContact" ct ON ct."deliveryCodeId" = dc.id
    GROUP BY dc.id, dc.code, dc.name, dc.description, dc."createdAt"
    ORDER BY dc.code ASC
  `
  return NextResponse.json(codes)
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session || (session.user as any)?.role !== 'admin') {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  const body = await req.json()

  // Sync fra BC
  if (body.syncFromBC) {
    const methods = await getShipmentMethods()
    if (methods.length === 0) return NextResponse.json({ error: 'Ingen forsendelsesmetoder fundet i BC' }, { status: 404 })
    const now = new Date().toISOString()
    let synced = 0
    for (const m of methods) {
      if (!m.code) continue
      await prisma.$executeRaw`
        INSERT INTO "DeliveryCode" (id, code, name, "createdAt")
        VALUES (${randomUUID()}, ${m.code}, ${m.description}, ${now})
        ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name
      `
      synced++
    }
    return NextResponse.json({ synced })
  }

  // Manuel opret
  const { code, name, description, contacts } = body
  if (!code || !name) return NextResponse.json({ error: 'Kode og navn er påkrævet' }, { status: 400 })

  const id = randomUUID()
  const now = new Date().toISOString()
  await prisma.$executeRaw`
    INSERT INTO "DeliveryCode" (id, code, name, description, "createdAt")
    VALUES (${id}, ${code.toUpperCase()}, ${name}, ${description ?? null}, ${now})
  `
  if (contacts?.length) {
    for (const c of contacts) {
      await prisma.$executeRaw`
        INSERT INTO "DeliveryContact" (id, "deliveryCodeId", name, email, phone, role)
        VALUES (${randomUUID()}, ${id}, ${c.name}, ${c.email ?? null}, ${c.phone ?? null}, ${c.role ?? 'transporter'})
      `
    }
  }
  return NextResponse.json({ id })
}
