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
import { aabentSignal, hentVare, markerBestilt, meldTom, sendTomHyldeVarsel } from '@/lib/kanban'

/** Samme vare meldt igen inden for så mange minutter giver ikke en mail mere.
 *  To scan på det samme kort er en rystende hånd, ikke to tomme hylder. */
const MAIL_PAUSE_MIN = 10

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  let body: { itemNo?: string; handling?: string; note?: string }
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

  // 150 tegn er hvad dialogen på terminalen tillader; her klippes der igen, fordi
  // ruten er offentlig og ikke må kunne fodres med en roman.
  const note = (body.note ?? '').trim().slice(0, 150)

  // Hvornår varen sidst blev meldt — SKAL læses før meldTom, der flytter lastAt.
  const foer = await aabentSignal(itemNo)
  const signal = await meldTom(itemNo, navn, note)

  // Mail hver gang nogen melder, så kontoret ved det med det samme. Undtagelsen er
  // det samme kort scannet to gange lige efter hinanden UDEN en ny besked — det er
  // en gentagelse, ikke en ny oplysning.
  const minutterSiden = foer ? (Date.now() - foer.lastAt.getTime()) / 60000 : Infinity
  if (note !== '' || minutterSiden >= MAIL_PAUSE_MIN) {
    // Bevidst uden await: meldingen er gemt, og brugeren skal ikke stå og vente på
    // en SMTP-server ved hylden.
    void sendTomHyldeVarsel({
      itemNo:      signal.itemNo,
      description: signal.description,
      shelfNo:     signal.shelfNo ?? '',
      baseUom:     signal.baseUom,
      bcInventory: signal.bcInventory === null ? null : Number(signal.bcInventory),
      antal:       signal.antal,
      meldtAf:     navn,
      note:        signal.note ?? '',
    })
  }

  return NextResponse.json({
    ok:     true,
    itemNo: signal.itemNo,
    antal:  signal.antal,
  })
}
