import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import webpush from 'web-push'

webpush.setVapidDetails(
  process.env.VAPID_MAILTO!,
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
  process.env.VAPID_PRIVATE_KEY!,
)

function checkApiKey(req: Request) {
  const key = req.headers.get('x-api-key')
  return key === process.env.BC_API_KEY
}

// GET /api/bc/messages/[customerNo] — BC henter tråd for en kunde (via BC-kundenr.)
export async function GET(req: Request, { params }: { params: { customerNo: string } }) {
  if (!checkApiKey(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { customerNo } = params

  const customer = await prisma.$queryRaw<{ id: string }[]>`
    SELECT id FROM "Customer" WHERE "bcCustomerNumber" = ${customerNo} LIMIT 1
  `
  if (!customer[0]) return NextResponse.json({ messages: [] })

  const customerId = customer[0].id

  const messages = await prisma.$queryRaw<{
    id: string; sender: string; senderName: string | null; body: string
    readByAdmin: boolean; readByCustomer: boolean; createdAt: Date
  }[]>`
    SELECT id, sender, "senderName", body, "readByAdmin", "readByCustomer", "createdAt"
    FROM "Message"
    WHERE "customerId" = ${customerId} AND "expiresAt" > NOW()
    ORDER BY "createdAt" ASC
  `

  // Markér kunde-beskeder som læst af admin ved hentning
  await prisma.$executeRaw`
    UPDATE "Message" SET "readByAdmin" = true
    WHERE "customerId" = ${customerId} AND sender = 'customer' AND "readByAdmin" = false
  `

  return NextResponse.json({
    messages: messages.map(m => ({
      id:             m.id,
      sender:         m.sender,
      senderName:     m.senderName,
      body:           m.body,
      readByAdmin:    m.readByAdmin,
      readByCustomer: m.readByCustomer,
      createdAt:      m.createdAt.toISOString(),
      createdAtDK:    m.createdAt.toLocaleString('da-DK', { timeZone: 'Europe/Copenhagen', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }),
    }))
  })
}

// POST /api/bc/messages/[customerNo] — BC sender besked til kunde
export async function POST(req: Request, { params }: { params: { customerNo: string } }) {
  if (!checkApiKey(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { customerNo } = params
  const { body } = await req.json()
  if (!body?.trim()) return NextResponse.json({ error: 'Tom besked' }, { status: 400 })

  const customer = await prisma.$queryRaw<{ id: string }[]>`
    SELECT id FROM "Customer" WHERE "bcCustomerNumber" = ${customerNo} LIMIT 1
  `
  if (!customer[0]) return NextResponse.json({ error: 'Kunde ikke fundet' }, { status: 404 })

  const customerId = customer[0].id
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

  return NextResponse.json({ ok: true, pushed: subs.length })
}
