// Kanban: meld en hylde tom, eller luk meldingen igen.
//
// Ruten kræver IKKE login. Det er med vilje: den der tømmer hylden er sjældent den,
// der går med håndterminalen, og en kanban-melding skal kunne afgives af den, der
// står med den sidste kasse i hånden. Er man logget ind, følger navnet med — ellers
// står der bare ikke hvem.
//
// Skaden ved misbrug er en falsk linje på kontorskærmen, som nogen kan trykke væk.
// Det er en mindre pris end en hylde, ingen melder tom, fordi man skulle logge ind.

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { hentVare, markerBestilt, meldTom } from '@/lib/kanban'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  let body: { itemNo?: string; handling?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'ugyldig krop' }, { status: 400 })
  }

  const itemNo = (body.itemNo ?? '').trim().toUpperCase()
  if (!itemNo) return NextResponse.json({ error: 'varenr. mangler' }, { status: 400 })

  const session = await getServerSession(authOptions)
  const navn = (session?.user?.name ?? '').trim()

  if (body.handling === 'bestilt') {
    const antal = await markerBestilt(itemNo, navn)
    return NextResponse.json({ ok: true, lukkede: antal })
  }

  // Varenummeret skal findes i BC. Ellers kunne en tastefejl i adresselinjen lægge
  // en vare, der ikke eksisterer, op på skærmen — og så mister listen sin troværdighed.
  const vare = await hentVare(itemNo).catch(() => null)
  if (!vare) {
    return NextResponse.json({ error: `Varenummer ${itemNo} findes ikke` }, { status: 404 })
  }

  const signal = await meldTom(itemNo, navn)
  return NextResponse.json({
    ok:     true,
    itemNo: signal.itemNo,
    antal:  signal.antal,
  })
}
