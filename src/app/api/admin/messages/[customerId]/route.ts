import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import webpush from 'web-push'

webpush.setVapidDetails(
  process.env.VAPID_MAILTO!,
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
  process.env.VAPID_PRIVATE_KEY!,
)

// GET — hent tråd for kunde
export async function GET(_: Request, { params }: { params: { customerId: string } }) {
  const session = await getServerSession(authOptions)
  if ((session?.user as any)?.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { customerId } = params

  const messages = await prisma.$queryRaw<{
    id: string; sender: string; senderName: string | null; body: string; readByAdmin: boolean; readByCustomer: boolean; createdAt: Date
  }[]>`
    SELECT id, sender, "senderName", body, "readByAdmin", "readByCustomer", "createdAt"
    FROM "Message"
    WHERE "customerId" = ${customerId} AND "expiresAt" > NOW()
    ORDER BY "createdAt" ASC
  `

  // Markér kunde-beskeder som læst af admin
  await prisma.$executeRaw`
    UPDATE "Message" SET "readByAdmin" = true
    WHERE "customerId" = ${customerId} AND sender = 'customer' AND "readByAdmin" = false
  `

  const customer = await prisma.$queryRaw<{ name: string; email: string; bcCustomerNumber: string }[]>`
    SELECT name, email, "bcCustomerNumber" FROM "Customer" WHERE id = ${customerId} LIMIT 1
  `

  return NextResponse.json({ customer: customer[0], messages })
}

// POST — admin sender besked
export async function POST(req: Request, { params }: { params: { customerId: string } }) {
  const session = await getServerSession(authOptions)
  if ((session?.user as any)?.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { customerId } = params
  const { body } = await req.json()
  if (!body?.trim()) return NextResponse.json({ error: 'Tom besked' }, { status: 400 })

  const expires = new Date(); expires.setDate(expires.getDate() + 30)

  await prisma.$executeRaw`
    INSERT INTO "Message" (id, "customerId", sender, "senderName", body, "readByAdmin", "readByCustomer", "createdAt", "expiresAt")
    VALUES (gen_random_uuid()::text, ${customerId}, 'admin', 'Venmark', ${body.trim()}, true, false, NOW(), ${expires})
  `

  // Push-notifikation til kunden
  const subs = await prisma.$queryRaw<{ endpoint: string; p256dh: string; auth: string }[]>`
    SELECT endpoint, p256dh, auth FROM "PushSubscription" WHERE "customerId" = ${customerId}
  `
  if (subs.length > 0) {
    const payload = JSON.stringify({ title: 'Besked fra Venmark', body: body.trim().slice(0, 100), url: '/portal/beskeder' })
    await Promise.allSettled(subs.map(s =>
      webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload)
    ))
  }

  return NextResponse.json({ ok: true })
}

// PUT — markér alle kunde-beskeder som læst
export async function PUT(_: Request, { params }: { params: { customerId: string } }) {
  const session = await getServerSession(authOptions)
  if ((session?.user as any)?.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  await prisma.$executeRaw`
    UPDATE "Message" SET "readByAdmin" = true
    WHERE "customerId" = ${params.customerId} AND sender = 'customer'
  `
  return NextResponse.json({ ok: true })
}
