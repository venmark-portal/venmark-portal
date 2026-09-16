// GET /api/portal/auktion-image/[imageId] — serverer et auktionsbillede (base64 i DB).
// Behind login. Egen sti (ikke under [id]) for at undgå rute-kollision med auktions-id.
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, { params }: { params: { imageId: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return new NextResponse('Unauthorized', { status: 401 })

  const img = await prisma.auctionImage.findUnique({
    where: { id: params.imageId },
    select: { data: true, mimeType: true },
  })
  if (!img) return new NextResponse('Not found', { status: 404 })

  // data = base64 (evt. som data-URL "data:...;base64,XXXX").
  const b64 = img.data.includes(',') ? img.data.slice(img.data.indexOf(',') + 1) : img.data
  const buf = Buffer.from(b64, 'base64')
  return new NextResponse(buf, {
    headers: {
      'Content-Type': img.mimeType || 'image/jpeg',
      'Cache-Control': 'private, max-age=3600',
    },
  })
}
