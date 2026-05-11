import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'x-api-key, Content-Type',
}

function checkApiKey(req: Request) {
  const key = req.headers.get('x-api-key')
  return key === process.env.BC_API_KEY
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS })
}

// GET /api/bc/messages/unread-counts — kunder med ulæste kunde-beskeder
export async function GET(req: Request) {
  if (!checkApiKey(req)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403, headers: CORS })
  }

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
  }, { headers: CORS })
}
