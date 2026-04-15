// GET /api/foto/kasse?entryNo=123    → fotos for én kasse
// PATCH /api/foto/kasse               → kobl fotos til salgsordre/kunde (ved scanning)

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET(req: NextRequest) {
  const entryNo = Number(req.nextUrl.searchParams.get('entryNo'))
  if (!entryNo) return NextResponse.json({ error: 'entryNo required' }, { status: 400 })

  const fotos = await prisma.boxPhoto.findMany({
    where: { bcBoxEntryNo: entryNo },
    orderBy: { takenAt: 'asc' },
  })
  return NextResponse.json(fotos)
}

export async function PATCH(req: NextRequest) {
  const body = await req.json()
  const { bcBoxEntryNo, bcSalesOrderNo, bcCustomerNo } = body
  if (!bcBoxEntryNo) return NextResponse.json({ error: 'bcBoxEntryNo required' }, { status: 400 })

  const updated = await prisma.boxPhoto.updateMany({
    where: { bcBoxEntryNo: Number(bcBoxEntryNo) },
    data: {
      bcSalesOrderNo: bcSalesOrderNo ?? undefined,
      bcCustomerNo: bcCustomerNo ?? undefined,
    },
  })
  return NextResponse.json({ updated: updated.count })
}
