// Ordbogen der følger med en optagelse til talegenkendelsen.
//
// Browserens egen genkendelse skrev "10 kW" og sprang "laksefilet" og "rødspætter"
// helt over (Claus 16-11). En talemodel gætter på de ord, den kender i forvejen —
// derfor sender vi vores EGNE ord med: fiskenavne, enheder og størrelser som de
// skrives her i huset. Modellen kan ikke overrule det, den faktisk hører, men den
// vælger den rigtige stavemåde, når lyden er tvetydig.

/** Ord der altid er relevante hos en fiskegrossist. Holdes kort — en lang liste
 *  udvander de ord der betyder noget, og modellen læser kun de første ~200 tegn. */
const FAST = [
  'laks', 'laksefilet', 'rødspætte', 'rødspættefilet', 'torsk', 'torskefilet',
  'kuller', 'kulmule', 'sej', 'mørksej', 'makrel', 'pebermakrel', 'peberlaks',
  'sild', 'hornfisk', 'havtaske', 'pighvar', 'slethvar', 'stenbider', 'rogn',
  'rejer', 'jomfruhummer', 'blåmuslinger', 'østers', 'kaviar',
  'halvskindet', 'skindfri', 'flået', 'flåede', 'hel', 'renset', 'filet',
  'kilo', 'kasse', 'kasser', 'dåse', 'dåser', 'stk', 'palle',
]

/** Varenavne står i BC med RÅB ("LAKSEFILET 1700/2100"). Sendes de sådan, skriver
 *  modellen gerne hele sætningen med store bogstaver. Navne der i forvejen har små
 *  bogstaver, lades som de er. */
function paentNavn(s: string): string {
  const t = String(s ?? '').trim()
  return /[a-zæøå]/.test(t) ? t : t.toLowerCase()
}

/** Kundens egne ord først (de vejer tungest), men ALDRIG så mange at de faste
 *  fiskeord bliver presset ud — en kunde kan have 80 favoritter. */
function byg(egne: string[], maksEgne: number, maks: number): string[] {
  const ord: string[] = []
  const set = new Set<string>()
  const tag = (liste: string[], loft: number) => {
    for (const o of liste) {
      const t = paentNavn(o)
      if (!t) continue
      const noegle = t.toLowerCase()
      if (set.has(noegle)) continue
      set.add(noegle)
      ord.push(t)
      if (ord.length >= loft) return
    }
  }
  tag(egne, Math.min(maksEgne, maks))
  tag(FAST, maks)
  return ord
}

/**
 * Bygger instruksen til talemodellen. `egne` er det der gælder lige nu — varen man
 * står med, kurvens varer, kundens favoritter.
 */
export function taleOrdbog(egne: string[] = []): string {
  const ord = byg(egne, 30, 50)
  // "ti kilo" er korrekt dansk, men ubrugeligt for os: antallet skal kunne læses af en
  // ordrelinje. Derfor står kravet om cifre først og helt firkantet.
  return `Dansk tale fra en fiskegrossist. Skriv ALTID antal med cifre og kort enhed: `
    + `"10 kg", ikke "ti kilo"; "3 kasser", ikke "tre kasser". Enheden kg skrives aldrig `
    + `som kW eller kilowatt. Størrelser skrives med romertal (str. III) eller interval `
    + `(1700-2100). Ord der kan forekomme: ${ord.join(', ')}.`
}

/** Ordene alene — til `keywords`-feltet på de nyere modeller. Her er der plads til flere
 *  end i prompten, for de udvander ikke en instruks. */
export function taleNoegleord(egne: string[] = []): string[] {
  return byg(egne, 80, 120)
}
