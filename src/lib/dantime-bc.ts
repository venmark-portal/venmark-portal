// Broen mellem Dan-Time-historikken og BC.
//
// To opgaver:
//  1) Synk joblisten til BC, så felterne på family-/vare-/ordrekort får en
//     opslagsliste der holder sig selv opdateret.
//  2) Skriv hvilke medarbejdere der var på linjen da en montageordre blev
//     AFSLUTTET (ikke bogført — Venmark afslutter før de bogfører).
//
// BC kalder aldrig Dan-Time. Det er med vilje: Dan-Time har intet API, og et
// nedbrud dér må aldrig kunne blokere en bogføring i BC.

import { getAccessToken, bcPortalBaseUrl } from '@/lib/businesscentral'
import { prisma } from '@/lib/prisma'
import { ensureDanTimeSchema, hvemVarPaaJob } from '@/lib/dantime'

async function bcFetch(sti: string, init: RequestInit = {}): Promise<Response> {
  const token = await getAccessToken()
  return fetch(`${bcPortalBaseUrl()}/${sti}`, {
    ...init,
    headers: {
      Authorization:  `Bearer ${token}`,
      Accept:         'application/json',
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
    cache: 'no-store',
  })
}

// ─── 1) Joblisten → BC ───────────────────────────────────────────────────────

export interface JobSynkResultat { set: number; oprettet: number; opdateret: number }

/**
 * Skriver ét job. "Last Seen" er markeret Editable = false i BC-tabellen, så
 * API'et afviser feltet ("Control 'lastSeen' is read-only"). Vi prøver med, og
 * falder tilbage til uden — så virker synkroniseringen i dag, OG feltet begynder
 * af sig selv at blive udfyldt den dag tabellen gør feltet skrivbart.
 */
async function skrivJob(
  sti: string, metode: 'POST' | 'PATCH', headers: Record<string, string>,
  jobNo: string, name: string, sidst: Date,
): Promise<boolean> {
  const grund = metode === 'POST' ? { jobNo, name } : { name }

  let r = await bcFetch(sti, {
    method: metode, headers,
    body: JSON.stringify({ ...grund, lastSeen: sidst.toISOString() }),
  })
  if (r.ok) return true

  const tekst = await r.text()
  if (r.status === 400 && tekst.includes('lastSeen')) {
    r = await bcFetch(sti, { method: metode, headers, body: JSON.stringify(grund) })
    if (r.ok) return true
    console.error(`[dantime→bc] job ${jobNo} (uden lastSeen):`, (await r.text()).slice(0, 200))
    return false
  }

  console.error(`[dantime→bc] job ${jobNo}:`, tekst.slice(0, 200))
  return false
}

/**
 * De job vi har set folk stemplet ind på, skrives til BC's "VM Dan-Time Job".
 * Navnet kan ændre sig i Dan-Time; nummeret er nøglen.
 */
export async function synkJobsTilBC(): Promise<JobSynkResultat> {
  await ensureDanTimeSchema()

  const set = await prisma.$queryRaw<{ jobNr: string; jobNavn: string | null; sidst: Date }[]>`
    SELECT "jobNr", MAX("jobNavn") AS "jobNavn", MAX("lastSeen") AS sidst
    FROM "DanTimeStempling" WHERE "jobNr" IS NOT NULL
    GROUP BY "jobNr"
  `
  if (set.length === 0) return { set: 0, oprettet: 0, opdateret: 0 }

  const res = await bcFetch('danTimeJobs?$top=500')
  if (!res.ok) throw new Error(`BC danTimeJobs fejl (${res.status}): ${await res.text()}`)
  const kendte: { id: string; jobNo: string; name: string }[] = (await res.json()).value ?? []
  const efterNr = new Map(kendte.map(j => [String(j.jobNo), j]))

  let oprettet = 0, opdateret = 0
  for (const j of set) {
    const navn = (j.jobNavn ?? '').slice(0, 50)
    const findes = efterNr.get(j.jobNr)

    if (!findes) {
      const r = await skrivJob('danTimeJobs', 'POST', {}, j.jobNr, navn, j.sidst)
      if (r) oprettet++
      continue
    }

    // Rør kun BC hvis navnet reelt har ændret sig — ellers larmer vi i deres
    // ændringslog for ingenting.
    if ((findes.name ?? '') !== navn) {
      const r = await skrivJob(`danTimeJobs(${findes.id})`, 'PATCH', { 'If-Match': '*' }, j.jobNr, navn, j.sidst)
      if (r) opdateret++
    }
  }
  return { set: set.length, oprettet, opdateret }
}

// ─── 2) Medarbejdere på afsluttede produktioner ──────────────────────────────

interface ProdOrdre {
  id: string; no: string; danTimeJobNo: string
  afsluttet: boolean; afsluttetKl: string | null
}

export interface FangResultat {
  set: number; behandlet: number; skrevet: number; udenJob: string[]; udenFolk: string[]
}

/** "2026-09-08T13:24:11Z" → dansk dato + klokkeslæt, som Dan-Time arbejder i. */
function tilDansk(iso: string): { dato: string; klokken: string } {
  const d = new Date(iso)
  const f = (o: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Copenhagen', ...o }).format(d)
  const [dag, md, aar] = f({ year: 'numeric', month: '2-digit', day: '2-digit' }).split('/')
  return { dato: `${aar}-${md}-${dag}`, klokken: f({ hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }) }
}

/**
 * Finder montageordrer der er afsluttet inden for de sidste `timer`, og skriver
 * hvem der var på linjen på præcis afslutningstidspunktet.
 *
 * Kører idempotent: en ordre der allerede har medarbejdere springes over, så
 * gentagne kørsler ikke dublerer. Genåbnes en ordre, nulstiller BC "Afsluttet
 * Kl.", og næste afslutning fanges forfra.
 */
export async function fangMedarbejdere(timer = 24): Promise<FangResultat> {
  const graense = new Date(Date.now() - timer * 3600_000)

  const res = await bcFetch(`prodOrders?$filter=afsluttet eq true&$top=500`)
  if (!res.ok) throw new Error(`BC prodOrders fejl (${res.status}): ${await res.text()}`)
  const alle: ProdOrdre[] = (await res.json()).value ?? []

  const nylige = alle.filter(o => o.afsluttetKl && new Date(o.afsluttetKl) >= graense)
  const udenJob: string[] = [], udenFolk: string[] = []
  let behandlet = 0, skrevet = 0

  for (const o of nylige) {
    if (!o.danTimeJobNo) { udenJob.push(o.no); continue }

    // Allerede fanget? Så lad den være.
    const fandtes = await bcFetch(
      `prodEmployees?$filter=productionNo eq '${o.no.replace(/'/g, "''")}'&$top=1`)
    if (fandtes.ok && ((await fandtes.json()).value ?? []).length > 0) continue

    const { dato, klokken } = tilDansk(o.afsluttetKl!)
    const folk = await hvemVarPaaJob(o.danTimeJobNo, dato, klokken)
    behandlet++
    if (folk.length === 0) { udenFolk.push(o.no); continue }

    for (const p of folk) {
      const min = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5))
      let minutter = min(p.ud ?? klokken) - min(p.ind)
      if (minutter < 0) minutter += 24 * 60

      const r = await bcFetch('prodEmployees', {
        method: 'POST',
        body: JSON.stringify({
          productionNo: o.no,
          employeeNo:   p.lonnr,
          name:         p.navn.slice(0, 100),
          jobNo:        o.danTimeJobNo,
          jobName:      (p.gruppe ?? '').slice(0, 50),
          minutes:      Math.max(0, minutter),
          capturedAt:   o.afsluttetKl,
        }),
      })
      if (r.ok) skrevet++
      else console.error(`[dantime→bc] ${o.no}/${p.lonnr}:`, (await r.text()).slice(0, 200))
    }
  }

  return { set: nylige.length, behandlet, skrevet, udenJob, udenFolk }
}
