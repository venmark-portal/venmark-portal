import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function GET() {
  const session = await getServerSession(authOptions)
  if ((session?.user as any)?.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const rows = await prisma.$queryRaw<{ count: bigint }[]>`SELECT COUNT(*)::int AS count FROM "PushSubscription"`
  const count = Number(rows[0]?.count ?? 0)
  return NextResponse.json({ count })
}
