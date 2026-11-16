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

/**
 * Bygger instruksen til talemodellen. `egne` er det der gælder lige nu — varen man
 * står med, kurvens varer, kundens faste varer — og kommer FØRST, fordi den vejer
 * tungest.
 */
export function taleOrdbog(egne: string[] = []): string {
  const ord: string[] = []
  const set = new Set<string>()
  for (const o of [...egne, ...FAST]) {
    const t = String(o ?? '').trim()
    if (!t) continue
    const noegle = t.toLowerCase()
    if (set.has(noegle)) continue
    set.add(noegle)
    ord.push(t)
    if (ord.length >= 60) break
  }
  return `Dansk tale fra en fiskegrossist. Antal står som tal med enhed (10 kg, 3 kasser), `
    + `aldrig som kW eller kilowatt. Størrelser skrives med romertal (str. III) eller interval `
    + `(1700-2100). Ord der kan forekomme: ${ord.join(', ')}.`
}

/** Ordene alene — til `keywords`-feltet på de nyere modeller. */
export function taleNoegleord(egne: string[] = []): string[] {
  const set = new Set<string>()
  const ud: string[] = []
  for (const o of [...egne, ...FAST]) {
    const t = String(o ?? '').trim()
    if (!t || set.has(t.toLowerCase())) continue
    set.add(t.toLowerCase())
    ud.push(t)
    if (ud.length >= 60) break
  }
  return ud
}
