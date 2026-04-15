// GET /api/foto/ordre?salesOrderNo=S-12345  → alle fotos for en salgsordre

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET(req: NextRequest) {
  const salesOrderNo = req.nextUrl.searchParams.get('salesOrderNo')
  if (!salesOrderNo) return NextResponse.json({ error: 'salesOrderNo required' }, { status: 400 })

  const fotos = await prisma.boxPhoto.findMany({
    where: { bcSalesOrderNo: salesOrderNo },
    orderBy: [{ bcBoxEntryNo: 'asc' }, { takenAt: 'asc' }],
  })
  return NextResponse.json(fotos)
}
