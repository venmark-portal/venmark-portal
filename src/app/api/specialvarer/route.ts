// GET  /api/specialvarer          → aktive specialvarer (portal bestil-side)
// POST /api/specialvarer          → opret fra BC (kræver x-api-key header)

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET() {
  const now = new Date()
  const varer = await prisma.specialVare.findMany({
    where: { isActive: true, expiresAt: { gt: now } },
    include: {
      reservations: {
        where: { status: { not: 'CANCELLED' } },
        select: { kg: true },
      },
    },
    orderBy: { createdAt: 'desc' },
  })

  // Beregn resterende kg
  const result = varer.map(v => ({
    id: v.id,
    bcItemNumber: v.bcItemNumber,
    itemName: v.itemName,
    boxEntryNo: v.boxEntryNo,
    availableKg: v.availableKg,
    reservedKg: v.reservations.reduce((sum, r) => sum + r.kg, 0),
    pricePerKg: v.pricePerKg,
    note: v.note,
    expiresAt: v.expiresAt,
  }))

  return NextResponse.json(result)
}

export async function POST(req: NextRequest) {
  // Autoriseret kald fra BC
  const apiKey = req.headers.get('x-api-key')
  if (apiKey !== process.env.BC_PORTAL_API_KEY) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const body = await req.json()
  const { bcItemNumber, itemName, boxEntryNo, availableKg, pricePerKg, note } = body

  if (!bcItemNumber || !availableKg) {
    return NextResponse.json({ error: 'bcItemNumber og availableKg kræves' }, { status: 400 })
  }

  // Udløb: i dag kl. 23:59:59
  const expiresAt = new Date()
  expiresAt.setHours(23, 59, 59, 0)

  const vare = await prisma.specialVare.create({
    data: {
      bcItemNumber,
      itemName: itemName || bcItemNumber,
      boxEntryNo: boxEntryNo ? Number(boxEntryNo) : null,
      availableKg: Number(availableKg),
      pricePerKg: pricePerKg ? Number(pricePerKg) : null,
      note: note || null,
      expiresAt,
    },
  })

  return NextResponse.json(vare)
}
