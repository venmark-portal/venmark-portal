import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export const runtime = 'nodejs'

const DEFAULTS = {
  id:             'default',
  bgColor:        '#eff6ff',
  bannerEnabled:  false,
  bannerText:     '',
  bannerBgColor:  '#1e40af',
  bannerTextColor:'#ffffff',
}

async function getOrCreate() {
  // Sørg for at rækken eksisterer
  await prisma.$executeRaw`
    INSERT INTO "PortalSettings"
      (id, "bgColor", "bannerEnabled", "bannerText", "bannerBgColor", "bannerTextColor", "updatedAt")
    VALUES
      ('default', '#eff6ff', false, '', '#1e40af', '#ffffff', NOW())
    ON CONFLICT (id) DO NOTHING
  `
  const rows = await prisma.$queryRaw<any[]>`
    SELECT id, "bgColor", "bannerEnabled", "bannerText", "bannerBgColor", "bannerTextColor"
    FROM "PortalSettings" WHERE id = 'default'
  `
  const r = rows[0]
  return {
    id:             r.id,
    bgColor:        r.bgColor,
    bannerEnabled:  Boolean(r.bannerEnabled),
    bannerText:     r.bannerText ?? '',
    bannerBgColor:  r.bannerBgColor,
    bannerTextColor:r.bannerTextColor,
  }
}

export async function GET() {
  try {
    return NextResponse.json(await getOrCreate())
  } catch (e) {
    return NextResponse.json(DEFAULTS)
  }
}

export async function PUT(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session || (session.user as any)?.role !== 'admin') {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  try {
    const b = await req.json()
    const bgColor        = b.bgColor        ?? DEFAULTS.bgColor
    const bannerEnabled  = b.bannerEnabled  ? 1 : 0
    const bannerText     = b.bannerText     ?? ''
    const bannerBgColor  = b.bannerBgColor  ?? DEFAULTS.bannerBgColor
    const bannerTextColor= b.bannerTextColor?? DEFAULTS.bannerTextColor

    await prisma.$executeRaw`
      INSERT INTO "PortalSettings"
        (id, "bgColor", "bannerEnabled", "bannerText", "bannerBgColor", "bannerTextColor", "updatedAt")
      VALUES
        ('default', ${bgColor}, ${bannerEnabled}, ${bannerText}, ${bannerBgColor}, ${bannerTextColor}, CURRENT_TIMESTAMP)
      ON CONFLICT(id) DO UPDATE SET
        "bgColor"         = excluded."bgColor",
        "bannerEnabled"   = excluded."bannerEnabled",
        "bannerText"      = excluded."bannerText",
        "bannerBgColor"   = excluded."bannerBgColor",
        "bannerTextColor" = excluded."bannerTextColor",
        "updatedAt"       = CURRENT_TIMESTAMP
    `
    return NextResponse.json(await getOrCreate())
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
