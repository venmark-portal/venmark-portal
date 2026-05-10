import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function GET() {
  const session = await getServerSession(authOptions)
  if ((session?.user as any)?.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const rows = await prisma.$queryRaw<{
    customerId: string
    customerName: string
    email: string
    bcCustomerNumber: string
    subCount: bigint
  }[]>`
    SELECT ps."customerId", c.name AS "customerName", c.email, c."bcCustomerNumber",
           c."deliveryCode", COUNT(*) AS "subCount"
    FROM "PushSubscription" ps
    JOIN "Customer" c ON c.id = ps."customerId"
    GROUP BY ps."customerId", c.name, c.email, c."bcCustomerNumber", c."deliveryCode"
    ORDER BY c.name
  `

  const subscribers = rows.map((r: any) => ({
    customerId:       r.customerId,
    customerName:     r.customerName,
    email:            r.email,
    bcCustomerNumber: r.bcCustomerNumber,
    deliveryCode:     r.deliveryCode ?? null,
    devices:          Number(r.subCount),
  }))

  return NextResponse.json({ count: subscribers.length, subscribers })
}
