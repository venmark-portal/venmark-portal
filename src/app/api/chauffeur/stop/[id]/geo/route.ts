import { NextRequest, NextResponse } from 'next/server'
import { getToken } from 'next-auth/jwt'
import { prisma } from '@/lib/prisma'

export const runtime = 'nodejs'

// Opdater GPS på seneste foto for et stop (kaldt bagefter upload)
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET })
  if (!token || token.role !== 'driver') {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  const { lat, lng } = await req.json()
  if (!lat || !lng || typeof lat !== 'number' || typeof lng !== 'number') {
    return NextResponse.json({ ok: false })
  }

  await prisma.$executeRaw`
    UPDATE "RouteStopPhoto"
    SET lat = ${lat}, lng = ${lng}
    WHERE "stopId" = ${params.id}
      AND "takenAt" = (
        SELECT MAX("takenAt") FROM "RouteStopPhoto" WHERE "stopId" = ${params.id}
      )
  `
  return NextResponse.json({ ok: true })
}
