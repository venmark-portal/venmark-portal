// Broen mellem optællingen og bestillingskurven.
//
// Hvorfor de to hænger sammen: man har netop MÅLT hylden. Beslutningen "skal vi
// bestille" hænger på beholdningen, og under en optælling er BC's beholdning det tal,
// man lige har modbevist. Så forslaget regnes på det talte (se `forslagsregel.ts`).
//
// HVAD DEN IKKE GØR: optællingen opretter ikke en købsordre. Den fylder en KURV, og
// kurven sendes af et menneske bagefter. To forskellige dokumenter i BC må ikke hænge
// på én knap — en TryFunction ruller ikke databaseskrivninger tilbage, så skrev
// kladden og fejlede købsordren, stod man med en halv afsendelse og ingen ren måde at
// gentage den. Se [[feedback_bc_tryfunction_no_rollback]].
//
// Kurven oprettes FØRST når det første forslag accepteres. En tom kurv pr. optælling
// ville ligge og fylde på bestillingslisten uden at nogen havde bestilt noget.

import { prisma } from '@/lib/prisma'
import { hentOptaelling, summerPrVare, type Optaelling } from '@/lib/lager/optaelling'
import {
  fjernLinje, hentBestilling, hentLinjer, scanTilKurv, startBestilling,
} from '@/lib/bestilling/bestilling'
import type { Forslag } from '@/lib/lager/forslagsregel'

export interface ForslagsLinje {
  itemNo: string
  description: string
  uom: string
  /** Hvilke hylder varen er talt på. En vare talt på én af to hylder har et
   *  ufuldstændigt tal, og det skal kunne ses, før man bestiller på det. */
  shelves: string
  forslag: Forslag
  /** Antallet der ligger i kurven nu, eller null når varen ikke er lagt i. */
  iKurv: number | null
}

export interface ForslagsSvar {
  /** false = BC-appen leverer ikke planlægningsfelterne endnu. Så er der ingen
   *  forslag at vise, og skærmen skal sige HVORFOR i stedet for at være tom. */
  tilgaengelig: boolean
  forslag: ForslagsLinje[]
  /**
   * Alt hvad der ligger i kurven — også varer der ikke længere er et forslag.
   * Tæller en kollega videre på en anden hylde, holder varen op med at være under sit
   * punkt, men den ligger stadig i kurven. Uden denne liste forsvandt mærket "i
   * kurven" fra skærmen, mens varen blev bestilt alligevel.
   */
  kurv: { itemNo: string; qty: number }[]
  bestillingId: string | null
  bestillingNo: string | null
}

/**
 * Forslagene for en hel optælling, med hvad der allerede ligger i kurven.
 *
 * `tilgaengelig` er false, når INGEN talt vare har planlægningsdata. Det er signalet
 * om, at BC-appen med indkøbsfelterne ikke er synkroniseret — til forskel fra
 * "der er ingen varer under genbestillingspunktet", som er et godt svar.
 */
export async function forslagForOptaelling(countId: string): Promise<ForslagsSvar> {
  const optaelling = await hentOptaelling(countId)
  if (!optaelling) {
    return { tilgaengelig: false, forslag: [], kurv: [], bestillingId: null, bestillingNo: null }
  }

  const varer = await summerPrVare(countId)
  const tilgaengelig = varer.some(v => v.planlaegning !== null)

  const kurv = optaelling.bestillingId ? await hentLinjer(optaelling.bestillingId) : []
  const iKurv = new Map(kurv.map(l => [l.itemNo, l.qty]))

  const bestilling = optaelling.bestillingId ? await hentBestilling(optaelling.bestillingId) : null

  const forslag: ForslagsLinje[] = varer
    .filter(v => v.forslag)
    .map(v => ({
      itemNo: v.itemNo,
      description: v.description,
      uom: v.uom,
      shelves: v.shelves,
      forslag: v.forslag!,
      iKurv: iKurv.get(v.itemNo) ?? null,
    }))
    // Tomme hylder først: de haster mere end en vare der er tæt på sit punkt.
    .sort((a, b) => {
      if (a.forslag.grund !== b.forslag.grund) return a.forslag.grund === 'tom-hylde' ? -1 : 1
      return a.itemNo.localeCompare(b.itemNo, 'da')
    })

  return {
    tilgaengelig,
    forslag,
    kurv: kurv.map(l => ({ itemNo: l.itemNo, qty: l.qty })),
    bestillingId: optaelling.bestillingId,
    bestillingNo: bestilling?.no ?? null,
  }
}

/**
 * Kurven optællingen fylder — oprettet hvis den ikke findes.
 *
 * Er kurven allerede SENDT, laves en ny: sendt er sendt, og en optælling der fortsætter
 * bagefter må ikke kunne lægge varer i en kurv, nogen har gjort færdig.
 */
export async function kurvTilOptaelling(
  optaelling: Optaelling,
  brugerId: string,
  brugerNavn: string,
): Promise<{ id: string; no: string }> {
  if (optaelling.bestillingId) {
    const findes = await hentBestilling(optaelling.bestillingId)
    if (findes && findes.status === 'aaben') return { id: findes.id, no: findes.no }
  }

  const ny = await startBestilling(optaelling.locationCode, brugerId, brugerNavn)
  await prisma.$executeRaw`
    UPDATE "LagerCount" SET "bestillingId" = ${ny.id} WHERE id = ${optaelling.id}
  `
  // Bemærkningen på kurven siger hvor den kommer fra. Står den i BC bagefter som en
  // købsordre, kan man finde tilbage til tællingen der udløste den.
  await prisma.$executeRaw`
    UPDATE "BestillingOrdre" SET note = ${`Fra optælling ${optaelling.no}`} WHERE id = ${ny.id}
  `
  console.log(`[lager forslag] kurv ${ny.no} oprettet til optælling ${optaelling.no} af ${brugerNavn}`)
  return { id: ny.id, no: ny.no }
}

/**
 * Accepterer et forslag: varen slås op i BC igen og lægges i kurven.
 *
 * Opslaget gentages med vilje. Leverandør og enhed skal være de aktuelle, når linjen
 * laves, og det er det samme opslag bestillingsappen selv bruger — så der er ÉN vej
 * ind i kurven, uanset om varen kom fra et scan, fra en kanban-melding eller herfra.
 *
 * `saet: true`: forslaget SÆTTER antallet. Trykker man to gange, får man ikke dobbelt
 * op — det ville være en bestilling, ingen havde ment.
 */
export async function accepterForslag(
  countId: string,
  itemNo: string,
  brugerId: string,
  brugerNavn: string,
  antal?: number,
): Promise<{ ok: boolean; fejl?: string; bestillingId?: string; bestillingNo?: string; qty?: number; vendorNo?: string }> {
  const optaelling = await hentOptaelling(countId)
  if (!optaelling) return { ok: false, fejl: 'Optællingen findes ikke' }

  const varer = await summerPrVare(countId)
  const vare = varer.find(v => v.itemNo === itemNo.toUpperCase())
  if (!vare) return { ok: false, fejl: 'Varen er ikke talt på denne optælling' }

  // Antallet tages fra forslaget, hvis der ikke er tastet et. Er varen ikke længere
  // under sit punkt — nogen har talt mere på en anden hylde — må den stadig kunne
  // bestilles manuelt; så er det et valg og ikke et forslag.
  const vaerdi = antal !== undefined && antal !== null ? antal : vare.forslag?.foreslaaet
  if (!vaerdi || vaerdi <= 0) return { ok: false, fejl: 'Intet antal at bestille' }

  const kurv = await kurvTilOptaelling(optaelling, brugerId, brugerNavn)
  const svar = await scanTilKurv(kurv.id, vare.itemNo, optaelling.locationCode, brugerNavn, {
    antal: vaerdi,
    saet: true,
  })
  if (!svar) return { ok: false, fejl: 'BC svarede ikke — prøv igen' }
  if (!svar.opslag.found) return { ok: false, fejl: `BC kender ikke varen ${vare.itemNo}` }

  return {
    ok: true,
    bestillingId: kurv.id,
    bestillingNo: kurv.no,
    qty: svar.linje?.qty,
    vendorNo: svar.linje?.vendorNo,
  }
}

/** Fortryd: tager varen ud af kurven igen. Kurven selv bliver stående. */
export async function afvisForslag(countId: string, itemNo: string): Promise<boolean> {
  const optaelling = await hentOptaelling(countId)
  if (!optaelling?.bestillingId) return false
  const bestilling = await hentBestilling(optaelling.bestillingId)
  if (!bestilling || bestilling.status !== 'aaben') return false
  return fjernLinje(optaelling.bestillingId, itemNo)
}
