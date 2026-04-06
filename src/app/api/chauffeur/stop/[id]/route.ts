import { NextRequest, NextResponse } from 'next/server'
import { getToken } from 'next-auth/jwt'
import { prisma } from '@/lib/prisma'

export const runtime = 'nodejs'

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET })
  if (!token || token.role !== 'driver') {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  const { status, failureNote } = await req.json()
  const validStatuses = ['PENDING', 'DELIVERED', 'FAILED', 'SKIPPED']
  if (!validStatuses.includes(status)) {
    return NextResponse.json({ error: 'Ugyldig status' }, { status: 400 })
  }

  const now  = new Date()
  const note = failureNote ?? null

  if (status === 'DELIVERED') {
    await prisma.$executeRaw`
      UPDATE "RouteStop"
      SET status = ${status}, "deliveredAt" = ${now}, "failureNote" = ${note}
      WHERE id = ${params.id}
    `
  } else {
    await prisma.$executeRaw`
      UPDATE "RouteStop"
      SET status = ${status}, "deliveredAt" = NULL, "failureNote" = ${note}
      WHERE id = ${params.id}
    `
  }

  return NextResponse.json({ ok: true })
}
