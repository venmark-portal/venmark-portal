import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getPortalPrices, toggleBCPortalFavorite } from '@/lib/businesscentral'

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Ikke logget ind' }, { status: 401 })

  const customerId   = (session.user as any)?.id               as string
  const customerNo   = (session.user as any)?.bcCustomerNumber as string ?? ''

  const { itemNo, itemName, isFavorite } = await req.json()
  if (!itemNo) return NextResponse.json({ error: 'itemNo mangler' }, { status: 400 })

  // Opdater portal DB
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

  // Forsøg BC-sync (best effort)
  if (customerNo) {
    try {
      const prices = await getPortalPrices(customerNo)
      const line   = prices.find((p) => p.itemNo === itemNo && p.sourceType === 'Customer')
      if (line?.id) {
        await toggleBCPortalFavorite(line.id, isFavorite)
      }
    } catch {
      // BC-sync fejler stille — portal DB er opdateret
    }
  }

  return NextResponse.json({ ok: true, isFavorite })
}
