// POST /api/specialvarer/reserver  → opret/opdater reservation (kræver session)
// DELETE /api/specialvarer/reserver → annuller reservation
// GET /api/specialvarer/reserver   → kundens aktive reservationer

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const customerId = (session.user as any).id as string

  const reservations = await prisma.specialVareReservation.findMany({
    where: {
      customerId,
      status: { not: 'CANCELLED' },
      specialVare: { isActive: true, expiresAt: { gt: new Date() } },
    },
    include: {
      specialVare: {
        select: { id: true, bcItemNumber: true, itemName: true, pricePerKg: true, expiresAt: true },
      },
    },
  })

  return NextResponse.json(reservations)
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const customerId = (session.user as any).id as string

  const { specialVareId, kg } = await req.json()
  if (!specialVareId || !kg || kg <= 0) {
    return NextResponse.json({ error: 'specialVareId og kg (>0) kræves' }, { status: 400 })
  }

  // Hent specialvaren og tjek den stadig er aktiv
  const vare = await prisma.specialVare.findFirst({
    where: { id: specialVareId, isActive: true, expiresAt: { gt: new Date() } },
    include: {
      reservations: {
        where: { status: { not: 'CANCELLED' } },
        select: { kg: true, customerId: true, id: true },
      },
    },
  })

  if (!vare) {
    return NextResponse.json({ error: 'Specialvaren findes ikke eller er udløbet' }, { status: 404 })
  }

  // Beregn allerede reserverede kg (ekskl. denne kundes evt. eksisterende reservation)
  const existingRes = vare.reservations.find(r => r.customerId === customerId)
  const othersReservedKg = vare.reservations
    .filter(r => r.customerId !== customerId)
    .reduce((sum, r) => sum + r.kg, 0)

  const remainingForCustomer = vare.availableKg - othersReservedKg
  if (kg > remainingForCustomer) {
    return NextResponse.json(
      { error: `Kun ${remainingForCustomer.toFixed(1)} kg tilbage` },
      { status: 409 }
    )
  }

  let reservation
  if (existingRes) {
    // Opdater eksisterende reservation
    reservation = await prisma.specialVareReservation.update({
      where: { id: existingRes.id },
      data: { kg, status: 'PENDING' },
    })
  } else {
    // Ny reservation
    reservation = await prisma.specialVareReservation.create({
      data: {
        specialVareId,
        customerId,
        kg,
        status: 'PENDING',
      },
    })
  }

  return NextResponse.json({
    reservationId: reservation.id,
    bcItemNumber: vare.bcItemNumber,
    itemName: vare.itemName,
    kg: reservation.kg,
    pricePerKg: vare.pricePerKg,
    boxEntryNo: vare.boxEntryNo,
  })
}

export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const customerId = (session.user as any).id as string

  const { reservationId } = await req.json()
  if (!reservationId) {
    return NextResponse.json({ error: 'reservationId kræves' }, { status: 400 })
  }

  const reservation = await prisma.specialVareReservation.findFirst({
    where: { id: reservationId, customerId },
  })
  if (!reservation) {
    return NextResponse.json({ error: 'Reservation ikke fundet' }, { status: 404 })
  }

  await prisma.specialVareReservation.update({
    where: { id: reservationId },
    data: { status: 'CANCELLED' },
  })

  return NextResponse.json({ ok: true })
}
