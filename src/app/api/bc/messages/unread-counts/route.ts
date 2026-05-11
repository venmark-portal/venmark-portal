import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

function checkApiKey(req: Request) {
  const key = req.headers.get('x-api-key')
  return key === process.env.BC_API_KEY
}

// GET /api/bc/messages/unread-counts — BC henter antal ulæste kundebesked pr. kunde
export async function GET(req: Request) {
  if (!checkApiKey(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const rows = await prisma.$queryRaw<{ customerNo: string; count: bigint }[]>`
    SELECT c."bcCustomerNumber" AS "customerNo", COUNT(m.id) AS count
    FROM "Message" m
    JOIN "Customer" c ON c.id = m."customerId"
    WHERE m.sender = 'customer'
      AND m."readByAdmin" = false
      AND m."expiresAt" > NOW()
    GROUP BY c."bcCustomerNumber"
  `

  return NextResponse.json({
    customers: rows.map(r => ({
      customerNo: r.customerNo,
      count: Number(r.count),
    }))
  })
}
