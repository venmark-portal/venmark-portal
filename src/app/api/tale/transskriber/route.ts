// POST multipart { lyd, ord? } → { tekst }
//
// Lyden optages i browseren og sendes HERTIL — nøglen til talemodellen findes kun på
// serveren. Både lagerfolk og indloggede kunder må bruge den; det er den samme
// diktat-knap i to apper.

import { NextRequest, NextResponse } from 'next/server'
import { getToken } from 'next-auth/jwt'
import { taleKonfigureret, transskriber } from '@/lib/tale/openai'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Lyd må ikke blive et uventet forbrug: et minut er rigeligt til en bestilling. */
const MAKS_BYTES = 8 * 1024 * 1024

/** Er diktaten slået til? Skærmen spørger én gang og falder ellers tilbage på
 *  browserens egen genkendelse, så knappen aldrig bare er død. */
export async function GET(req: NextRequest) {
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET })
  if (!token) return new NextResponse('Unauthorized', { status: 401 })
  return NextResponse.json({ klar: taleKonfigureret() })
}

export async function POST(req: NextRequest) {
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET })
  if (!token) return new NextResponse('Unauthorized', { status: 401 })
  if (!taleKonfigureret()) {
    return NextResponse.json({ error: 'Diktat er ikke slået til på serveren' }, { status: 503 })
  }

  const form = await req.formData().catch(() => null)
  const lyd = form?.get('lyd')
  if (!(lyd instanceof Blob) || lyd.size === 0) {
    return NextResponse.json({ error: 'Ingen lyd modtaget' }, { status: 400 })
  }
  if (lyd.size > MAKS_BYTES) {
    return NextResponse.json({ error: 'Optagelsen er for lang' }, { status: 413 })
  }

  // Varenavne fra skærmen: den vare man står med, kurvens varer, kundens faste varer.
  let ord: string[] = []
  try {
    const raa = String(form?.get('ord') ?? '')
    if (raa) ord = JSON.parse(raa)
  } catch { /* ordbogen er en hjælp, ikke et krav */ }

  // Filendelsen skal passe til lyden: iOS optager mp4, Android/Chrome webm.
  const type = lyd.type || 'audio/webm'
  const endelse = type.includes('mp4') || type.includes('m4a') ? 'm4a'
    : type.includes('ogg') ? 'ogg'
      : type.includes('wav') ? 'wav' : 'webm'

  try {
    const tekst = await transskriber(lyd, `diktat.${endelse}`, Array.isArray(ord) ? ord : [])
    return NextResponse.json({ tekst })
  } catch (e: any) {
    // Logges med besked: en tavs 500 på en diktat-knap er umulig at fejlsøge bagefter.
    console.error('[tale] transskribering fejlede:', e?.message ?? e)
    return NextResponse.json({ error: 'Talegenkendelsen svarede ikke' }, { status: 502 })
  }
}
