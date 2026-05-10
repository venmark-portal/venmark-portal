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

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  const isAdmin = !!(session?.user as any)?.isAdmin
  if (!isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { title, body, url, customerIds } = await req.json()
  if (!title || !body) return NextResponse.json({ error: 'title and body required' }, { status: 400 })

  const payload = JSON.stringify({ title, body, url: url || '/portal', tag: 'venmark-push' })

  let subs: { endpoint: string; p256dh: string; auth: string }[]

  if (customerIds && customerIds.length > 0) {
    subs = await prisma.$queryRaw`
      SELECT endpoint, p256dh, auth FROM "PushSubscription"
      WHERE "customerId" = ANY(${customerIds}::text[])
    `
  } else {
    subs = await prisma.$queryRaw`SELECT endpoint, p256dh, auth FROM "PushSubscription"`
  }

  const results = await Promise.allSettled(
    subs.map(sub =>
      webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payload,
      )
    )
  )

  const sent = results.filter(r => r.status === 'fulfilled').length
  const failed = results.filter(r => r.status === 'rejected').length

  // Ryd op: fjern subscriptions der returnerede 404/410 (browser har afmeldt)
  const toDelete: string[] = []
  results.forEach((r, i) => {
    if (r.status === 'rejected') {
      const status = (r.reason as any)?.statusCode
      if (status === 404 || status === 410) toDelete.push(subs[i].endpoint)
    }
  })
  if (toDelete.length > 0) {
    await prisma.$executeRaw`DELETE FROM "PushSubscription" WHERE endpoint = ANY(${toDelete}::text[])`
  }

  return NextResponse.json({ sent, failed, total: subs.length })
}
