import { NextRequest, NextResponse } from 'next/server'
import { getToken } from 'next-auth/jwt'
import { prisma } from '@/lib/prisma'
import { ensureRouteSchema, loadVehicles } from '@/lib/route-plan-db'

export const runtime = 'nodejs'

// GET: chaufførens standardbil + listen over biler
export async function GET(req: NextRequest) {
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET })
  if (!token || token.role !== 'driver') return new NextResponse('Unauthorized', { status: 401 })
  await ensureRouteSchema()
  const rows = await prisma.$queryRaw<any[]>`
    SELECT "defaultVehicleLabel" FROM "DriverUser" WHERE id = ${token.sub as string} LIMIT 1
  `
  return NextResponse.json({ myVehicle: rows[0]?.defaultVehicleLabel ?? 'Bil 1', vehicles: await loadVehicles() })
}

// PATCH: { myVehicle: "Bil N" } — chaufføren skifter sin standardbil (huskes til næste login)
export async function PATCH(req: NextRequest) {
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET })
  if (!token || token.role !== 'driver') return new NextResponse('Unauthorized', { status: 401 })
  const { myVehicle } = await req.json()
  if (!/^Bil \d{1,2}$/.test(String(myVehicle ?? ''))) {
    return NextResponse.json({ error: 'Ugyldig bil' }, { status: 400 })
  }
  await prisma.$executeRaw`
    UPDATE "DriverUser" SET "defaultVehicleLabel" = ${myVehicle}, "updatedAt" = ${new Date().toISOString()}::timestamp
    WHERE id = ${token.sub as string}
  `
  return NextResponse.json({ ok: true, myVehicle })
}
