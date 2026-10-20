import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { ensureRouteSchema, loadVehicles } from '@/lib/route-plan-db'

export const runtime = 'nodejs'

async function isAdmin() {
  const session = await getServerSession(authOptions)
  return Boolean(session && (session.user as any)?.role === 'admin')
}

// GET: alle biler (navngivne + numre i brug)
export async function GET() {
  if (!(await isAdmin())) return new NextResponse('Unauthorized', { status: 401 })
  await ensureRouteSchema()
  return NextResponse.json(await loadVehicles())
}

// PUT: { number, name, plate?, active? } — opret eller ret en bil
export async function PUT(req: NextRequest) {
  if (!(await isAdmin())) return new NextResponse('Unauthorized', { status: 401 })
  const { number, name, plate, active } = await req.json()
  const n = Number(number)
  if (!Number.isInteger(n) || n < 1 || n > 99) {
    return NextResponse.json({ error: 'Bilnummer skal være 1–99' }, { status: 400 })
  }
  await ensureRouteSchema()
  const now = new Date().toISOString()
  await prisma.$executeRaw`
    INSERT INTO "Vehicle" ("number", "name", "plate", "active", "updatedAt")
    VALUES (${n}, ${String(name ?? '').trim()}, ${plate ? String(plate).trim() : null}, ${active !== false}, ${now}::timestamp)
    ON CONFLICT ("number") DO UPDATE
      SET "name" = EXCLUDED."name", "plate" = EXCLUDED."plate",
          "active" = EXCLUDED."active", "updatedAt" = EXCLUDED."updatedAt"
  `
  return NextResponse.json(await loadVehicles())
}
