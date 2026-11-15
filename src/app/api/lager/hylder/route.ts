import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { lagerBruger } from '@/lib/lager/auth'
import { ensureLagerSchema, hentHylder } from '@/lib/lager/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Hylder er APPENS eget begreb — BC's placeringer (bins) er ikke slået til, og at slå
// dem til ville tvinge en hylde på salg, montage, produktion og varemodtagelse fra dag ét.
// Appen lægger sammen pr. vare og sender ÉN linje pr. vare til BC.

// GET [?locationCode=] — hylderne, i den rækkefølge man går lageret igennem.
export async function GET(req: NextRequest) {
  const bruger = await lagerBruger(req)
  if (!bruger) return new NextResponse('Unauthorized', { status: 401 })
  const lokation = (req.nextUrl.searchParams.get('locationCode') ?? '').trim().toUpperCase()
  return NextResponse.json(await hentHylder(lokation))
}

// POST { locationCode, code, name, sortOrder? } — opret eller ret en hylde.
// Må laves fra terminalen: står man ved en reol der ikke findes i listen, skal man
// kunne tilføje den og tælle videre, ikke gå ind på kontoret.
export async function POST(req: NextRequest) {
  const bruger = await lagerBruger(req)
  if (!bruger) return new NextResponse('Unauthorized', { status: 401 })
  if (!bruger.maaTaelle) return NextResponse.json({ error: 'Ingen adgang' }, { status: 403 })

  const body = await req.json().catch(() => null)
  const lokation = String(body?.locationCode ?? '').trim().toUpperCase()
  const kode = String(body?.code ?? '').trim().toUpperCase()
  const navn = String(body?.name ?? '').trim() || kode
  const sortering = Number(body?.sortOrder ?? 0)
  if (!lokation || !kode) {
    return NextResponse.json({ error: 'locationCode og code skal udfyldes' }, { status: 400 })
  }

  await ensureLagerSchema()
  const id = `shelf_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
  // Findes hylden, opdateres navn og rækkefølge i stedet for at fejle: to terminaler
  // må godt tilføje den samme reol.
  await prisma.$executeRaw`
    INSERT INTO "LagerShelf" ("id","locationCode","code","name","sortOrder")
    VALUES (${id}, ${lokation}, ${kode}, ${navn}, ${sortering})
    ON CONFLICT ("locationCode","code")
    DO UPDATE SET name = EXCLUDED.name, "sortOrder" = EXCLUDED."sortOrder", "isActive" = true
  `
  return NextResponse.json(await hentHylder(lokation))
}
