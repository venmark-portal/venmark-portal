import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { ensureRouteSchema } from '@/lib/route-plan-db'
import { randomUUID } from 'crypto'

export const runtime = 'nodejs'

// NB: Postgres kræver dobbelte anførselstegn om tabel-/kolonnenavne med store bogstaver
// (se CLAUDE.md). Uden dem blev DeliveryCode til deliverycode → "relation does not exist".
export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session || (session.user as any)?.role !== 'admin') return new NextResponse('Unauthorized', { status: 401 })

  const { code, name, description, contacts, ownRoute } = await req.json()
  await ensureRouteSchema()
  await prisma.$executeRaw`
    UPDATE "DeliveryCode"
    SET code = ${code.toUpperCase()}, name = ${name}, description = ${description ?? null},
        "ownRoute" = ${Boolean(ownRoute)}
    WHERE id = ${params.id}
  `
  // Erstat alle kontakter
  await prisma.$executeRaw`DELETE FROM "DeliveryContact" WHERE "deliveryCodeId" = ${params.id}`
  if (contacts?.length) {
    for (const c of contacts) {
      await prisma.$executeRaw`
        INSERT INTO "DeliveryContact" (id, "deliveryCodeId", name, email, phone, role)
        VALUES (${randomUUID()}, ${params.id}, ${c.name}, ${c.email ?? null}, ${c.phone ?? null}, ${c.role ?? 'transporter'})
      `
    }
  }
  return NextResponse.json({ ok: true })
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session || (session.user as any)?.role !== 'admin') return new NextResponse('Unauthorized', { status: 401 })
  await prisma.$executeRaw`DELETE FROM "DeliveryCode" WHERE id = ${params.id}`
  return NextResponse.json({ ok: true })
}
