// Admin: GET én auktion (m. rigtige navne), PATCH (start/aflys/afslut/redigér), DELETE.
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function adminOnly(session: any) {
  return session && (session.user as any)?.role === 'admin'
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!adminOnly(session)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const a = await prisma.auction.findUnique({
    where: { id: params.id },
    include: {
      images: { orderBy: { sort: 'asc' }, select: { id: true } },
      bids: { orderBy: { createdAt: 'desc' }, select: { bidderName: true, amount: true, maxAmount: true, createdAt: true } },
    },
  })
  if (!a) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  return NextResponse.json({
    id: a.id, title: a.title, description: a.description, itemNo: a.itemNo, lotText: a.lotText,
    priceMode: a.priceMode, status: a.status,
    minPrice: Number(a.minPrice), currentPrice: Number(a.currentPrice),
    leaderName: a.leaderName, leaderMax: a.leaderMax == null ? null : Number(a.leaderMax),
    bidCount: a.bidCount, startsAt: a.startsAt, endsAt: a.endsAt,
    imageIds: a.images.map((i) => i.id),
    bids: a.bids.map((b) => ({ name: b.bidderName, amount: Number(b.amount), max: b.maxAmount == null ? null : Number(b.maxAmount), at: b.createdAt })),
  })
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!adminOnly(session)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const a = await prisma.auction.findUnique({ where: { id: params.id } })
  if (!a) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  let b: any
  try { b = await req.json() } catch { return NextResponse.json({ error: 'bad_request' }, { status: 400 }) }

  // Handlinger.
  if (b?.action === 'start') {
    if (a.status !== 'DRAFT') return NextResponse.json({ error: 'Kun kladder kan startes.' }, { status: 400 })
    await prisma.auction.update({ where: { id: a.id }, data: { status: 'LIVE', startsAt: new Date() } })
    return NextResponse.json({ ok: true })
  }
  if (b?.action === 'cancel') {
    await prisma.auction.update({ where: { id: a.id }, data: { status: 'CANCELLED' } })
    return NextResponse.json({ ok: true })
  }
  if (b?.action === 'end') {
    await prisma.auction.update({ where: { id: a.id }, data: { status: 'ENDED', endsAt: new Date() } })
    return NextResponse.json({ ok: true })
  }

  // Redigering.
  const data: any = {}
  if (a.status === 'DRAFT') {
    // Kladde → fuld redigering (inkl. billeder = erstat).
    if (typeof b.title === 'string') data.title = b.title.trim()
    if (typeof b.description === 'string') data.description = b.description
    if ('itemNo' in b) data.itemNo = b.itemNo ? String(b.itemNo) : null
    if ('lotText' in b) data.lotText = b.lotText ? String(b.lotText) : null
    if (b.priceMode === 'TOTAL' || b.priceMode === 'PER_KG') data.priceMode = b.priceMode
    if (b.minPrice != null) data.minPrice = Math.max(0, Number(b.minPrice) || 0)
    if (b.endsAt) {
      const e = new Date(b.endsAt)
      if (isNaN(e.getTime()) || e.getTime() <= Date.now()) return NextResponse.json({ error: 'Ugyldig udløbstid.' }, { status: 400 })
      data.endsAt = e
    }
    if (Array.isArray(b.images)) {
      await prisma.auctionImage.deleteMany({ where: { auctionId: a.id } })
      const imgs = b.images.slice(0, 3).filter((im: any) => im?.data)
      data.images = { create: imgs.map((im: any, i: number) => ({ data: String(im.data), mimeType: String(im.mimeType || 'image/jpeg'), sort: i })) }
    }
  } else if (a.status === 'LIVE') {
    // Live → kun forlæng udløbstid (ingen pris/mode-ændring når der kan være bud).
    if (b.endsAt) {
      const e = new Date(b.endsAt)
      if (isNaN(e.getTime()) || e.getTime() <= Date.now()) return NextResponse.json({ error: 'Ugyldig udløbstid.' }, { status: 400 })
      data.endsAt = e
    } else {
      return NextResponse.json({ error: 'Live auktion kan kun få forlænget udløbstid.' }, { status: 400 })
    }
  } else {
    return NextResponse.json({ error: 'Auktionen kan ikke redigeres.' }, { status: 400 })
  }

  await prisma.auction.update({ where: { id: a.id }, data })
  return NextResponse.json({ ok: true })
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!adminOnly(session)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  await prisma.auction.delete({ where: { id: params.id } }).catch(() => {})
  return NextResponse.json({ ok: true })
}
