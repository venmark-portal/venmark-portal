// GET  /api/foto/pending?stationId=X  → næste uncaptured pending
// POST /api/foto/pending               → opret pending (kaldt fra BC via HttpClient)
// PATCH /api/foto/pending              → marker captured

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET(req: NextRequest) {
  const stationId = req.nextUrl.searchParams.get('stationId') || 'default'
  const pending = await prisma.pendingCapture.findFirst({
    where: { stationId, captured: false },
    orderBy: { requestedAt: 'asc' },
  })
  return NextResponse.json(pending)
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { bcBoxEntryNo, stationId = 'default' } = body
  if (!bcBoxEntryNo) return NextResponse.json({ error: 'bcBoxEntryNo required' }, { status: 400 })

  const pending = await prisma.pendingCapture.create({
    data: { bcBoxEntryNo: Number(bcBoxEntryNo), stationId },
  })
  return NextResponse.json(pending)
}

export async function PATCH(req: NextRequest) {
  const body = await req.json()
  const { id } = body
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  await prisma.pendingCapture.update({
    where: { id },
    data: { captured: true },
  })
  return NextResponse.json({ ok: true })
}
