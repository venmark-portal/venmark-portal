import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 })

  const customerId = (session.user as any)?.id as string
  if (!customerId) return NextResponse.json({ error: 'No customer id' }, { status: 400 })

  const { endpoint, keys } = await req.json()
  if (!endpoint || !keys?.p256dh || !keys?.auth) {
    return NextResponse.json({ error: 'Invalid subscription' }, { status: 400 })
  }

  await prisma.$executeRaw`
    INSERT INTO "PushSubscription" (id, "customerId", endpoint, p256dh, auth, "createdAt")
    VALUES (gen_random_uuid()::text, ${customerId}, ${endpoint}, ${keys.p256dh}, ${keys.auth}, NOW())
    ON CONFLICT (endpoint) DO UPDATE SET "customerId" = ${customerId}, p256dh = ${keys.p256dh}, auth = ${keys.auth}
  `

  return NextResponse.json({ ok: true })
}

export async function DELETE(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 })

  const { endpoint } = await req.json()
  if (!endpoint) return NextResponse.json({ error: 'Missing endpoint' }, { status: 400 })

  await prisma.$executeRaw`DELETE FROM "PushSubscription" WHERE endpoint = ${endpoint}`
  return NextResponse.json({ ok: true })
}
