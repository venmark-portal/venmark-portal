// Reglen for HVORNÅR en optalt vare bliver et bestillingsforslag.
//
// Filen er bevidst ren: ingen prisma, ingen fetch, ingen imports. Både skærmen og
// serveren skal bruge den samme regel — skærmen for at kunne vise forslaget i samme
// øjeblik varen er talt, serveren for at kunne lave listen til sidst. To steder med
// hver sin udgave af reglen er ét for mange; det ene bliver rettet, og det andet ikke.
//
// Tallene i forslaget er ALLE BC's egne: ordrekvantum og genbestillingspunkt.
// Der regnes ikke en ordrestørrelse ud her — et forslag må ikke være en opfindelse.

/** Hvorfor varen foreslås bestilt. Teksten til gulvet står i `forslagstekst`. */
export type Forslagsgrund = 'under-punkt' | 'tom-hylde'

export interface Planlaegning {
  /** Varens leverandør på varekortet. Tom = ikke en indkøbsvare (fx egenproduktion). */
  vendorNo: string
  /** Genbestillingspunkt. 0 = ikke sat på varen. */
  reorderPoint: number
  /** Ordrekvantum (varekortets felt 36). 0 = ikke sat. */
  reorderQuantity: number
}

export interface Forslag {
  grund: Forslagsgrund
  /** Hvad der blev talt — IKKE BC's beholdning. Se nedenfor. */
  talt: number
  /** Genbestillingspunktet, eller 0 når varen ikke har et. */
  punkt: number
  /** Hvad der mangler op til punktet. 0 når varen ikke har et punkt. */
  mangler: number
  /** Det antal der foreslås bestilt. Altid i basisenheden. */
  foreslaaet: number
}

/**
 * Afgør om en optalt vare bør bestilles.
 *
 * **Der regnes på det TALTE, ikke på BC's beholdning.** Tællingen er ikke bogført, når
 * man står ved hylden: BC siger stadig 40, hvor der er 2. Regnede vi på BC's tal, ville
 * en hylde man lige har fundet tom se fuld ud, og der kom intet forslag — den værste
 * slags fejl, for den ser ud som om funktionen er slået fra.
 *
 * Returnerer null når varen ikke skal foreslås, og null når `planlaegning` er null:
 * det sidste betyder, at BC-appen ikke leverer indkøbsfelterne endnu.
 */
export function vurderForslag(talt: number, p: Planlaegning | null): Forslag | null {
  if (!p) return null

  // Ingen leverandør på varekortet = ikke en indkøbsvare. Filteret er vigtigt, fordi en
  // optælling dækker HELE lageret, også egenproduktion og varer på vej ud. Uden det
  // blev hver tredje linje et forslag, og så læser ingen listen. Filteret vedligeholder
  // sig selv: får varen en leverandør, er den med næste gang.
  if (!p.vendorNo) return null

  const punkt = p.reorderPoint > 0 ? p.reorderPoint : 0
  const mangler = punkt > 0 ? Math.max(0, punkt - talt) : 0

  let grund: Forslagsgrund
  if (punkt > 0) {
    // Afrunding: en vægtvare kan stå 0,0000001 under punktet uden at nogen mangler noget.
    if (talt > punkt + 0.001) return null
    grund = 'under-punkt'
  } else {
    // Varen har intet genbestillingspunkt — de færreste har. Så er den tomme hylde det
    // eneste utvetydige signal vi har, og det er godt nok: har man talt 0, er der 0.
    if (talt > 0.001) return null
    grund = 'tom-hylde'
  }

  // Ordrekvantum vinder, som i resten af bestillingsappen. Findes det ikke, foreslås
  // det der mangler op til punktet — også BC's eget tal. Ellers 1, og så retter
  // lagermanden det selv.
  const foreslaaet = p.reorderQuantity > 0 ? p.reorderQuantity : mangler > 0 ? mangler : 1

  return { grund, talt, punkt, mangler, foreslaaet }
}

/** Én linje til skærmen. Kort, for den skal kunne læses mellem to scanninger. */
export function forslagstekst(f: Forslag, enhed = ''): string {
  const tal = (n: number) => n.toLocaleString('da-DK', { maximumFractionDigits: 3 })
  const e = enhed ? ` ${enhed}` : ''
  if (f.grund === 'tom-hylde') return `Hylden er tom — intet genbestillingspunkt på varen`
  return (
    `Talt ${tal(f.talt)}${e} — genbestillingspunkt ${tal(f.punkt)}` +
    (f.mangler > 0.001 ? ` (mangler ${tal(f.mangler)})` : '')
  )
}
