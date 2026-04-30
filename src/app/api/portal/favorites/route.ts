import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { addBCCustomerFavorite, removeBCCustomerFavorite } from '@/lib/businesscentral'

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
