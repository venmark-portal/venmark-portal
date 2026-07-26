import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getPortalOrderAccesses } from '@/lib/businesscentral'
import { getParentCustomerNo, getActiveCustomerNo } from '@/lib/activeCustomer'

export const dynamic = 'force-dynamic'

/**
 * Kunde-vælgerens datakilde. Returnerer login-kunden selv + de butikker den må
 * bestille til (fra BC portalOrderAccesses). Tom `stores` → portalen viser ingen
 * vælger. `active` = det aktuelt valgte kundenr. (fra sessionen).
 */
export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) {
    return NextResponse.json({ error: 'Ikke logget ind' }, { status: 401 })
  }

  const parentNo = getParentCustomerNo(session)
  const stores   = await getPortalOrderAccesses(parentNo)

  return NextResponse.json({
    self: {
      customerNo:   parentNo,
      customerName: (session.user as any)?.name ?? parentNo,
    },
    stores,
    active: getActiveCustomerNo(session),
  })
}
