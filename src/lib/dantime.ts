// Dan-Time situationsrapport → vores egen historik.
//
// HVORFOR VI SELV GEMMER: rapporten viser kun det SENESTE stempel pr. medarbejder,
// og jobnummeret forsvinder i det øjeblik personen stempler ud. Man kan altså ikke
// spørge Dan-Time "hvem var på job 13 kl. 14:32?" bagudrettet. Vi sampler derfor
// løbende og bygger vores egne intervaller — det er den eneste måde at kunne sætte
// medarbejdere på en produktion ud fra dens afslutningstidspunkt.
//
// Dan-Time har (pr. 2026-09-08) intet API, så vi læser HTML'en fra DeepLink-URL'en.

import https from 'https'
import { prisma } from '@/lib/prisma'

export interface DanTimeRow {
  lonnr:    string
  navn:     string
  afdeling: string
  gruppe:   string
  dato:     string          // YYYY-MM-DD
  ind:      string          // HH:MM
  ud:       string | null   // HH:MM — null = stadig stemplet ind
  jobNr:    string | null   // kun udfyldt mens personen er inde
  jobNavn:  string | null
}

let ensured: Promise<void> | null = null

async function run(): Promise<void> {
  // Ét interval = én persons stempling. (lonnr, dato, ind) er nøglen; Dan-Time viser
  // samme række igen og igen indtil personen stempler næste gang.
  await prisma.$executeRaw`
    CREATE TABLE IF NOT EXISTS "DanTimeStempling" (
      id          TEXT PRIMARY KEY,
      lonnr       TEXT NOT NULL,
      navn        TEXT NOT NULL,
      afdeling    TEXT,
      gruppe      TEXT,
      dato        TEXT NOT NULL,
      ind         TEXT NOT NULL,
      ud          TEXT,
      "jobNr"     TEXT,
      "jobNavn"   TEXT,
      "firstSeen" TIMESTAMP(3) NOT NULL DEFAULT NOW(),
      "lastSeen"  TIMESTAMP(3) NOT NULL DEFAULT NOW()
    )
  `
  await prisma.$executeRaw`
    CREATE UNIQUE INDEX IF NOT EXISTS "DanTimeStempling_key"
      ON "DanTimeStempling" (lonnr, dato, ind)
  `
  await prisma.$executeRaw`
    CREATE INDEX IF NOT EXISTS "DanTimeStempling_job_idx" ON "DanTimeStempling" ("jobNr", dato)
  `
}

export function ensureDanTimeSchema(): Promise<void> {
  if (!ensured) ensured = run().catch(err => { ensured = null; throw err })
  return ensured
}

// ─── Hentning ────────────────────────────────────────────────────────────────

function hentHtml(url: string): Promise<string> {
  return new Promise((res, rej) => {
    // rejectUnauthorized: Dan-Times server sender ikke Let's Encrypts mellem-
    // certifikat, så kæden kan ikke bygges. Fejlen er i DERES opsætning (en
    // enkelt linje at rette); indtil da kan vi ikke validere kæden. Bed dem
    // rette det — så kan flaget fjernes her.
    const req = https.get(url, { rejectUnauthorized: false, timeout: 30_000 }, r => {
      const chunks: Buffer[] = []
      r.on('data', c => chunks.push(c))
      // Siden er iso-8859-1, ikke UTF-8 — ellers bliver æ/ø/å til tegnsalat.
      r.on('end', () => res(Buffer.concat(chunks).toString('latin1')))
    })
    req.on('timeout', () => { req.destroy(new Error('Dan-Time svarede ikke inden 30 sek')) })
    req.on('error', rej)
  })
}

/** "8/09/26" → "2026-09-08" */
function tilIso(dato: string): string | null {
  const m = dato.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/)
  if (!m) return null
  const [, d, md, y] = m
  const aar = y.length === 2 ? `20${y}` : y
  return `${aar}-${md.padStart(2, '0')}-${d.padStart(2, '0')}`
}

/** "9:06" → "09:06" */
function tilHhmm(t: string): string | null {
  const m = t.trim().match(/^(\d{1,2}):(\d{2})$/)
  return m ? `${m[1].padStart(2, '0')}:${m[2]}` : null
}

export function parseSituationsrapport(html: string): DanTimeRow[] {
  const uden = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')

  const raekker = Array.from(uden.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)).map(m =>
    Array.from(m[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)).map(c =>
      c[1].replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim(),
    ),
  )

  const ud: DanTimeRow[] = []
  for (const r of raekker) {
    // Kolonner: 0 Lønnr · 1 Navn · 2 Filial · 3 Afdeling · 4 Gruppe · 5 Type
    //           6 Dag · 7 Dato · 8 IND · 9 UD · 10 JobNr · 11 JobNavn · 12 OrdreNr · 13 OrdreNavn
    if (r.length < 12 || !/^\d{3,6}$/.test(r[0] ?? '')) continue
    const dato = tilIso(r[7] ?? '')
    const ind  = tilHhmm(r[8] ?? '')
    if (!dato || !ind) continue
    ud.push({
      lonnr:    r[0],
      navn:     r[1] ?? '',
      afdeling: r[3] ?? '',
      gruppe:   r[4] ?? '',
      dato,
      ind,
      ud:       tilHhmm(r[9] ?? ''),
      jobNr:    (r[10] ?? '').trim() || null,
      jobNavn:  (r[11] ?? '').trim() || null,
    })
  }
  return ud
}

export async function hentSituationsrapport(): Promise<DanTimeRow[]> {
  const url = process.env.DANTIME_URL
  if (!url) throw new Error('DANTIME_URL mangler i .env.local')
  return parseSituationsrapport(await hentHtml(url))
}

// ─── Indlæsning ──────────────────────────────────────────────────────────────

export interface IngestResultat {
  hentet: number; nye: number; lukkede: number
}

/**
 * Gem det vi ser nu. Jobnummeret bevares fra da personen var stemplet IND —
 * Dan-Time smider det væk ved udstempling, så vi må ikke overskrive med tomt.
 */
export async function ingestDanTime(raekker: DanTimeRow[]): Promise<IngestResultat> {
  await ensureDanTimeSchema()
  let nye = 0, lukkede = 0

  for (const r of raekker) {
    const id = `${r.lonnr}|${r.dato}|${r.ind}`
    const fx = await prisma.$executeRaw`
      INSERT INTO "DanTimeStempling" (id, lonnr, navn, afdeling, gruppe, dato, ind, ud, "jobNr", "jobNavn")
      VALUES (${id}, ${r.lonnr}, ${r.navn}, ${r.afdeling}, ${r.gruppe}, ${r.dato}, ${r.ind}, ${r.ud}, ${r.jobNr}, ${r.jobNavn})
      ON CONFLICT (lonnr, dato, ind) DO UPDATE SET
        ud         = COALESCE(EXCLUDED.ud, "DanTimeStempling".ud),
        -- Behold det job vi så mens personen var inde.
        "jobNr"    = COALESCE(EXCLUDED."jobNr", "DanTimeStempling"."jobNr"),
        "jobNavn"  = COALESCE(EXCLUDED."jobNavn", "DanTimeStempling"."jobNavn"),
        "lastSeen" = NOW()
    `
    if (fx === 1) nye++
    if (r.ud) lukkede++
  }

  // Sikkerhedsnet: rapporten viser kun SENESTE stempling pr. person, så skifter
  // nogen job uden at vi når at se udstemplingen, ville det gamle interval stå
  // åbent for evigt og tælle timer i det uendelige. Ingen kan være to steder på
  // én gang — så et åbent interval lukkes ved næste interval samme dag.
  await prisma.$executeRaw`
    UPDATE "DanTimeStempling" a SET ud = (
      SELECT MIN(b.ind) FROM "DanTimeStempling" b
      WHERE b.lonnr = a.lonnr AND b.dato = a.dato AND b.ind > a.ind)
    WHERE a.ud IS NULL AND EXISTS (
      SELECT 1 FROM "DanTimeStempling" b
      WHERE b.lonnr = a.lonnr AND b.dato = a.dato AND b.ind > a.ind)
  `

  return { hentet: raekker.length, nye, lukkede }
}

// ─── Timer pr. job ───────────────────────────────────────────────────────────

export interface JobTimer {
  jobNr:    string
  jobNavn:  string | null
  personer: number
  minutter: number
  timer:    number
}

/**
 * Arbejdstimer pr. job for en dag. Timerne er EKSAKTE — de regnes af
 * stemplingernes egne IND/UD, ikke af sample-intervallet.
 *
 * Pauser er allerede trukket fra: folk stempler ud når de holder pause, så et
 * interval indeholder kun arbejdstid. Åbne intervaller tælles til og med nu.
 */
/** Dagens dato i dansk tid (YYYY-MM-DD) — samme dato som stemplingerne gemmes på. */
export function copenhagenDato(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Copenhagen' }).format(now)
}

export async function timerPrJob(dato: string): Promise<JobTimer[]> {
  await ensureDanTimeSchema()
  const rows = await prisma.$queryRaw<{
    jobNr: string; jobNavn: string | null; ind: string; ud: string | null
  }[]>`
    SELECT "jobNr", "jobNavn", ind, ud FROM "DanTimeStempling"
    WHERE dato = ${dato} AND "jobNr" IS NOT NULL
  `

  const nu = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Copenhagen', hourCycle: 'h23', hour: '2-digit', minute: '2-digit',
  }).format(new Date())

  const min = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5))
  const pr = new Map<string, JobTimer>()

  for (const r of rows) {
    const slut = r.ud ?? nu
    let m = min(slut) - min(r.ind)
    if (m < 0) m += 24 * 60          // vagt hen over midnat
    if (m <= 0) continue

    const e = pr.get(r.jobNr) ??
      { jobNr: r.jobNr, jobNavn: r.jobNavn, personer: 0, minutter: 0, timer: 0 }
    e.personer += 1
    e.minutter += m
    pr.set(r.jobNr, e)
  }

  const ud = Array.from(pr.values())
  for (const e of ud) e.timer = Math.round((e.minutter / 60) * 100) / 100
  return ud.sort((a, b) => b.minutter - a.minutter)
}

// ─── Opslag ──────────────────────────────────────────────────────────────────

export interface PaaJob {
  lonnr: string; navn: string; gruppe: string
  ind: string; ud: string | null
}

/** Hvem er stemplet ind på jobbet lige nu? */
export async function hvemErPaaJobNu(jobNr: string): Promise<PaaJob[]> {
  await ensureDanTimeSchema()
  return prisma.$queryRaw<PaaJob[]>`
    SELECT lonnr, navn, gruppe, ind, ud FROM "DanTimeStempling"
    WHERE "jobNr" = ${jobNr} AND ud IS NULL
    ORDER BY navn
  `
}

/**
 * Hvem var på jobbet på et bestemt tidspunkt? Bruges til at sætte medarbejdere
 * på en produktion ud fra dens afslutningstidspunkt.
 *
 * `dato`/`klokken` er dansk lokaltid (YYYY-MM-DD / HH:MM) — samme tid som både
 * Dan-Time og BC's "Afsluttet Kl." arbejder i.
 */
export async function hvemVarPaaJob(jobNr: string, dato: string, klokken: string): Promise<PaaJob[]> {
  await ensureDanTimeSchema()
  const rows = await prisma.$queryRaw<PaaJob[]>`
    SELECT lonnr, navn, gruppe, ind, ud FROM "DanTimeStempling"
    WHERE "jobNr" = ${jobNr} AND dato = ${dato}
    ORDER BY navn
  `
  return rows.filter(r => {
    if (!r.ud) return klokken >= r.ind              // stadig inde
    if (r.ud >= r.ind) return klokken >= r.ind && klokken <= r.ud
    // Vagt hen over midnat (fx 19:00–06:00): tidspunktet ligger i den ene ende.
    return klokken >= r.ind || klokken <= r.ud
  })
}
