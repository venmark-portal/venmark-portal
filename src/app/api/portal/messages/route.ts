import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { flagBeskedUlaest } from '@/lib/businesscentral'

// GET — kundens tråd (seneste 30 dage)
export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 })
  const customerId = (session.user as any)?.id as string

  const messages = await prisma.$queryRaw<{
    id: string; sender: string; senderName: string | null; body: string; readByCustomer: boolean; createdAt: Date
  }[]>`
    SELECT id, sender, "senderName", body, "readByCustomer", "createdAt"
    FROM "Message"
    WHERE "customerId" = ${customerId} AND "expiresAt" > NOW()
    ORDER BY "createdAt" ASC
  `

  // Markér admin-beskeder som læst
  await prisma.$executeRaw`
    UPDATE "Message" SET "readByCustomer" = true
    WHERE "customerId" = ${customerId} AND sender = 'admin' AND "readByCustomer" = false
  `

  return NextResponse.json({ messages })
}

// POST — kunden sender besked
export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 })
  const customerId = (session.user as any)?.id as string
  const customerName = session.user?.name ?? 'Kunde'

  const { body } = await req.json()
  if (!body?.trim()) return NextResponse.json({ error: 'Tom besked' }, { status: 400 })

  const expires = new Date(); expires.setDate(expires.getDate() + 30)

  await prisma.$executeRaw`
    INSERT INTO "Message" (id, "customerId", sender, "senderName", body, "readByAdmin", "readByCustomer", "createdAt", "expiresAt")
    VALUES (gen_random_uuid()::text, ${customerId}, 'customer', ${customerName}, ${body.trim()}, false, true, NOW(), ${expires})
  `

  // Notificer BC om ulæst besked (non-blocking — fejl er ikke fatale)
  const rows = await prisma.$queryRaw<{ bcCustomerNumber: string }[]>`
    SELECT "bcCustomerNumber" FROM "Customer" WHERE id = ${customerId} LIMIT 1
  `
  if (rows[0]?.bcCustomerNumber) {
    flagBeskedUlaest(rows[0].bcCustomerNumber).catch(() => {})
  }

  return NextResponse.json({ ok: true })
}
