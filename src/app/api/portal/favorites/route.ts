import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { addBCCustomerFavorite, removeBCCustomerFavorite, setBCStandardFavorite } from '@/lib/businesscentral'

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Ikke logget ind' }, { status: 401 })

  const customerId = (session.user as any)?.id               as string
  const customerNo = (session.user as any)?.bcCustomerNumber as string ?? ''

  const { itemNo, itemName, isFavorite } = await req.json()
  if (!itemNo) return NextResponse.json({ error: 'itemNo mangler' }, { status: 400 })

  // Opdater portal DB (primær kilde)
  if (isFavorite) {
    await prisma.favorite.upsert({
      where:  { customerId_bcItemNumber: { customerId, bcItemNumber: itemNo } },
      create: { customerId, bcItemNumber: itemNo, itemName: itemName ?? itemNo },
      update: {},
    })
  } else {
    await prisma.favorite.deleteMany({
      where: { customerId, bcItemNumber: itemNo },
    })
  }

  // Sync til BC tabel 50157 — altid, uanset om der er en prislinje
  if (customerNo) {
    try {
      if (isFavorite) {
        await addBCCustomerFavorite(customerNo, itemNo, itemName ?? itemNo)
      } else {
        await removeBCCustomerFavorite(customerNo, itemNo)
      }
    } catch {
      // BC-sync er best-effort — portal DB er altid opdateret
    }
  }

  return NextResponse.json({ ok: true, isFavorite })
}

// STD-pin: løft (eller fjern) en favorit til "VARER DU ALTID SKAL HAVE" (Standard Favorite på
// tabel 50157). At pinne indebærer at varen ER en favorit — sikres i portal-DB'en først.
export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Ikke logget ind' }, { status: 401 })

  const customerId = (session.user as any)?.id               as string
  const customerNo = (session.user as any)?.bcCustomerNumber as string ?? ''

  const { itemNo, itemName, isStandard } = await req.json()
  if (!itemNo || typeof isStandard !== 'boolean')
    return NextResponse.json({ error: 'itemNo/isStandard mangler' }, { status: 400 })

  // Pin → sørg for at varen findes som favorit i portal-DB'en.
  if (isStandard) {
    await prisma.favorite.upsert({
      where:  { customerId_bcItemNumber: { customerId, bcItemNumber: itemNo } },
      create: { customerId, bcItemNumber: itemNo, itemName: itemName ?? itemNo },
      update: {},
    })
  }

  if (customerNo) {
    try {
      await setBCStandardFavorite(customerNo, itemNo, isStandard, itemName ?? itemNo)
    } catch {
      // BC-sync er best-effort
    }
  }

  return NextResponse.json({ ok: true, isStandard })
}
