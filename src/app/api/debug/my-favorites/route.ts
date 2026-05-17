import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getCustomerFavorites } from '@/lib/businesscentral'

export const dynamic = 'force-dynamic'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Ikke logget ind' }, { status: 401 })

  const customerId = (session.user as any)?.id               as string
  const customerNo = (session.user as any)?.bcCustomerNumber as string ?? ''

  const [bcFavs, dbFavs] = await Promise.all([
    getCustomerFavorites(customerNo).catch((e: any) => ({ error: e.message })),
    prisma.favorite.findMany({ where: { customerId }, orderBy: { bcItemNumber: 'asc' } }),
  ])

  const bcItems = Array.isArray(bcFavs) ? bcFavs.map(f => f.itemNo).sort() : []
  const dbItems = dbFavs.map(f => f.bcItemNumber).sort()

  const onlyInBC = bcItems.filter(n => !dbItems.includes(n))
  const onlyInDB = dbItems.filter(n => !bcItems.includes(n))
  const inBoth   = bcItems.filter(n => dbItems.includes(n))

  return NextResponse.json({
    session: { customerId, customerNo },
    bc_tabel_50157: Array.isArray(bcFavs) ? { count: bcItems.length, items: bcItems } : bcFavs,
    portal_db:      { count: dbItems.length, items: dbItems },
    diff: { only_in_bc: onlyInBC, only_in_db: onlyInDB, in_both: inBoth },
    will_show_in_portal: bcItems.length > 0 ? bcItems : dbItems,
  })
}
