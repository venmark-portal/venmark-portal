import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

// GET /api/admin/messages — alle kunder med ulæste + seneste besked
export async function GET() {
  const session = await getServerSession(authOptions)
  if ((session?.user as any)?.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const rows = await prisma.$queryRaw<{
    customerId: string
    customerName: string
    email: string
    bcCustomerNumber: string
    latestBody: string
    latestAt: Date
    latestSender: string
    unreadCount: bigint
    totalCount: bigint
  }[]>`
    SELECT
      c.id            AS "customerId",
      c.name          AS "customerName",
      c.email,
      c."bcCustomerNumber",
      last.body       AS "latestBody",
      last."createdAt" AS "latestAt",
      last.sender     AS "latestSender",
      COUNT(*) FILTER (WHERE m."readByAdmin" = false AND m.sender = 'customer') AS "unreadCount",
      COUNT(*)        AS "totalCount"
    FROM "Message" m
    JOIN "Customer" c ON c.id = m."customerId"
    JOIN LATERAL (
      SELECT body, "createdAt", sender FROM "Message"
      WHERE "customerId" = m."customerId"
      ORDER BY "createdAt" DESC LIMIT 1
    ) last ON true
    WHERE m."expiresAt" > NOW()
    GROUP BY c.id, c.name, c.email, c."bcCustomerNumber", last.body, last."createdAt", last.sender
    ORDER BY last."createdAt" DESC
  `

  return NextResponse.json(rows.map(r => ({
    customerId:       r.customerId,
    customerName:     r.customerName,
    email:            r.email,
    bcCustomerNumber: r.bcCustomerNumber,
    latestBody:       r.latestBody,
    latestAt:         r.latestAt,
    latestSender:     r.latestSender,
    unreadCount:      Number(r.unreadCount),
    totalCount:       Number(r.totalCount),
  })))
}
