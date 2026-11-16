// POST { tekst } → mp3
//
// Robottens stemme, lavet på serveren. Telefonens egen oplæsning kræver en talepakke,
// som kunderne ikke har installeret (Claus' Samsung havde ingen dansk — 16-11), og
// den kan vi ikke bede dem om. Lyd herfra lyder ens hos alle.

import { NextRequest, NextResponse } from 'next/server'
import { getToken } from 'next-auth/jwt'
import { oplaesTale, taleKonfigureret } from '@/lib/tale/openai'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Et talt svar er kort. Længere tekst er en fejl et andet sted — og koster penge. */
const MAKS_TEGN = 600

export async function POST(req: NextRequest) {
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET })
  if (!token) return new NextResponse('Unauthorized', { status: 401 })
  if (!taleKonfigureret()) return new NextResponse('Oplæsning er ikke slået til', { status: 503 })

  const body = await req.json().catch(() => null)
  const tekst = String(body?.tekst ?? '').trim().slice(0, MAKS_TEGN)
  const sprog = String(body?.sprog ?? 'da').slice(0, 2)
  if (!tekst) return new NextResponse('Ingen tekst', { status: 400 })

  try {
    const lyd = await oplaesTale(tekst, sprog)
    return new NextResponse(lyd, {
      headers: { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'no-store' },
    })
  } catch (e: any) {
    console.error('[tale] oplæsning fejlede:', e?.message ?? e)
    return new NextResponse('Oplæsningen svarede ikke', { status: 502 })
  }
}
