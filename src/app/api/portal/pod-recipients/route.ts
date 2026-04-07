import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { randomUUID } from 'crypto'

export const runtime = 'nodejs'

async function ensureTable() {
  await prisma.$executeRaw`
    CREATE TABLE IF NOT EXISTS "PodRecipient" (
      id             TEXT PRIMARY KEY,
      "bcCustomerNo" TEXT NOT NULL,
      name           TEXT,
      email          TEXT,
      phone          TEXT,
      "sendEmail"    BOOLEAN NOT NULL DEFAULT false,
      "sendSms"      BOOLEAN NOT NULL DEFAULT false,
      "sortOrder"    INTEGER NOT NULL DEFAULT 0
    )
  `
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return new NextResponse('Unauthorized', { status: 401 })
  const bcCustomerNo = (session.user as any).bcCustomerNumber
  if (!bcCustomerNo) return NextResponse.json([])
  await ensureTable()
  const rows = await prisma.$queryRaw<any[]>`
    SELECT id, name, email, phone, "sendEmail", "sendSms", "sortOrder"
    FROM "PodRecipient"
    WHERE "bcCustomerNo" = ${bcCustomerNo}
    ORDER BY "sortOrder"
  `
  return NextResponse.json(rows)
}

export async function PUT(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return new NextResponse('Unauthorized', { status: 401 })
  const bcCustomerNo = (session.user as any).bcCustomerNumber
  if (!bcCustomerNo) return NextResponse.json({ ok: false })
  await ensureTable()

  const recipients: { id?: string; name: string; email: string; phone: string; sendEmail: boolean; sendSms: boolean }[] = await req.json()

  // Slet eksisterende og indsæt nye (simpel replace)
  await prisma.$executeRaw`DELETE FROM "PodRecipient" WHERE "bcCustomerNo" = ${bcCustomerNo}`
  for (let i = 0; i < recipients.length; i++) {
    const r = recipients[i]
    await prisma.$executeRaw`
      INSERT INTO "PodRecipient" (id, "bcCustomerNo", name, email, phone, "sendEmail", "sendSms", "sortOrder")
      VALUES (${randomUUID()}, ${bcCustomerNo}, ${r.name || null}, ${r.email || null}, ${r.phone || null},
              ${r.sendEmail}, ${r.sendSms}, ${i})
    `
  }
  return NextResponse.json({ ok: true })
}
