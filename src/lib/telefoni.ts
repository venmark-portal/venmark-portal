// Teams-telefoni til kontorskærmen: antal opkald og minutter.
//
// Venmark kører Direct Routing (bekræftet i Teams Admin Center → Usage reports →
// PSTN usage → fanen "Direct Routing"). Derfor `getDirectRoutingCalls` og ikke
// `getPstnCalls`, som dækker Calling Plan/Operator Connect og ville svare tomt.
//
// KERNEBESLUTNING: opkaldene KOPIERES ind i vores egen tabel og læses derfra.
// Microsoft gemmer kun Direct Routing-data i 150 dage, så henter man live, ruller
// historikken væk bagfra hver eneste dag. Med kopien samler statistikken sig
// fremad for altid, og skærmen bliver samtidig hurtig — den rører ikke Graph.
//
// Kræver APPLIKATIONS-tilladelsen CallRecords.Read.All med administrator-samtykke
// (det er den Microsoft kræver til netop denne funktion). Mangler den, svarer
// Graph 403, og skærmen siger det i stedet for at vise nul opkald.
//
// OPKALDSTYPER: Graph svarer `ByotIn`, `ByotOut`, `ByotInUcap`,
// `ByotOutUserTransfer`. Det er IKKE de samme navne som Teams Admin Center viser
// i sin egen brugerflade (`dr_in`, `dr_in_bot`) — dem findes kun i UI'et. Matcher
// man på dem, falder hvert eneste opkald igennem til "udgående".
// "Ucap" = opkaldet gik gennem omstilling eller kø (fx Hovednummer_AA).

import { prisma } from '@/lib/prisma'
import { ensureSignageSchema } from '@/lib/signage/schema'

export interface TelefoniPerson {
  navn:     string
  ind:      number
  ud:       number
  /** Sekunder — vises som minutter, men summeres præcist. */
  sekunder: number
}

export interface TelefoniTime {
  time:   number   // 0-23, dansk tid
  opkald: number
}

export interface TelefoniStat {
  dato:       string
  ind:        number
  ud:         number
  /** Indgående opkald hvor ingen nåede at tage den. */
  ubesvarede: number
  sekunder:   number
  /** Median svartid i sekunder på indgående opkald — null hvis intet er målt endnu. */
  ventMedian: number | null
  /** Den langsomste tiendedel. Gennemsnit skjuler netop de opkald der gør ondt. */
  ventP90:    number | null
  personer:   TelefoniPerson[]
  timer:      TelefoniTime[]
  /** Sat når tilladelsen mangler — så siger skærmen det i stedet for at vise 0. */
  mangler?:   string
}

/** Dagsstatistik til historik — én række pr. dag. */
export interface TelefoniDag {
  dag:        string
  opkald:     number
  ind:        number
  ud:         number
  minutter:   number
  ubesvarede: number
  ventMedian: number | null
}

function median(tal: number[]): number | null {
  if (tal.length === 0) return null
  const s = [...tal].sort((a, b) => a - b)
  return Math.round(s[Math.floor(s.length / 2)])
}

function percentil(tal: number[], p: number): number | null {
  if (tal.length === 0) return null
  const s = [...tal].sort((a, b) => a - b)
  return Math.round(s[Math.min(s.length - 1, Math.floor(s.length * p))])
}

/**
 * Svartid pr. dag, til historik og udvikling over tid. Regnes på tværs af
 * begge kilder — direkte opkald (trunk) og hovednummer-opkald (sessioner).
 */
export async function telefoniDage(antalDage = 30): Promise<TelefoniDag[]> {
  await ensureSignageSchema()
  const fra = new Date(Date.now() - antalDage * 864e5)

  const raekker = await prisma.$queryRaw<{
    dag: string; retning: string; sekunder: number; ventSek: number | null; ventKilde: string | null
  }[]>`
    SELECT "dagDk" AS dag, retning, sekunder, "ventSek", "ventKilde"
    FROM "TeamsCall"
    WHERE "startTime" >= ${fra}
  `

  const pr = new Map<string, { ind: number; ud: number; sek: number; ubes: number; vent: number[] }>()
  for (const r of raekker) {
    const d = pr.get(r.dag) ?? { ind: 0, ud: 0, sek: 0, ubes: 0, vent: [] }
    if (r.retning === 'ind') d.ind++; else d.ud++
    d.sek += r.sekunder
    if (r.ventKilde === 'ubesvaret') d.ubes++
    else if (r.ventSek !== null && r.retning === 'ind') d.vent.push(r.ventSek)
    pr.set(r.dag, d)
  }

  return Array.from(pr.entries())
    .map(([dag, d]) => ({
      dag,
      opkald:     d.ind + d.ud,
      ind:        d.ind,
      ud:         d.ud,
      minutter:   Math.round(d.sek / 60),
      ubesvarede: d.ubes,
      ventMedian: median(d.vent),
    }))
    .sort((a, b) => a.dag.localeCompare(b.dag))
}

// ─── Graph ───────────────────────────────────────────────────────────────────

async function graphToken(): Promise<string> {
  const tenant = process.env.BC_TENANT_ID!
  const id     = process.env.GRAPH_CLIENT_ID     ?? process.env.BC_CLIENT_ID!
  const secret = process.env.GRAPH_CLIENT_SECRET ?? process.env.BC_CLIENT_SECRET!

  const res = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    new URLSearchParams({
      grant_type: 'client_credentials', client_id: id, client_secret: secret,
      scope: 'https://graph.microsoft.com/.default',
    }),
    cache: 'no-store',   // aldrig cache et token-svar (heller ikke en 401)
  })
  if (!res.ok) throw new Error(`Graph-token ${res.status}`)
  return (await res.json()).access_token
}

const dkFormat = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Copenhagen' })
const dkTime   = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Copenhagen', hour: '2-digit', hour12: false,
})

export function idagDk(): string {
  return dkFormat.format(new Date())
}

export class TilladelseMangler extends Error {}

/**
 * Ind- eller udgående ud fra Graphs callType.
 *
 * Både Graphs egne navne (`ByotIn`, `ByotOutUserTransfer`) og admin-centerets
 * UI-navne (`dr_in`) håndteres, så vi ikke bliver ramt igen hvis Microsoft
 * skifter skrivemåde.
 */
export function retningAf(callType: string): 'ind' | 'ud' {
  const t = String(callType ?? '').toLowerCase().replace(/^byot/, '').replace(/^dr_/, '')
  if (t.startsWith('in'))  return 'ind'
  if (t.startsWith('out')) return 'ud'
  return t.includes('in') ? 'ind' : 'ud'
}

/** Gik opkaldet gennem omstilling/kø i stedet for direkte til en person? */
export function viaBotAf(callType: string): boolean {
  const t = String(callType ?? '').toLowerCase()
  return t.includes('ucap') || t.includes('bot')
}

/**
 * Henter opkald i et tidsrum fra Graph og gemmer dem. Kan køres igen på samme
 * periode uden at dublere — `id` er Graphs eget opkalds-id.
 *
 * Perioden deles i bidder, fordi lange spænd både er tunge og lettere rammer
 * Graphs egne grænser. Returnerer hvor mange rækker der blev rørt.
 */
export async function synkTelefoni(fra: Date, til: Date, dagePrBid = 7): Promise<{ hentet: number; gemt: number }> {
  await ensureSignageSchema()
  const token = await graphToken()

  let hentet = 0
  let gemt   = 0

  for (let start = new Date(fra); start < til; start = new Date(start.getTime() + dagePrBid * 864e5)) {
    const slut = new Date(Math.min(start.getTime() + dagePrBid * 864e5, til.getTime()))

    let url: string | null =
      `https://graph.microsoft.com/v1.0/communications/callRecords/getDirectRoutingCalls` +
      `(fromDateTime=${start.toISOString().slice(0, 19)}Z,toDateTime=${slut.toISOString().slice(0, 19)}Z)`

    let sider = 0
    while (url && sider++ < 200) {
      const res: Response = await fetch(url, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        cache: 'no-store',
      } as any)
      if (res.status === 401 || res.status === 403) {
        throw new TilladelseMangler('CallRecords.Read.All mangler administrator-samtykke')
      }
      if (!res.ok) {
        throw new Error(`Graph getDirectRoutingCalls ${res.status}: ${(await res.text()).slice(0, 200)}`)
      }
      const data = await res.json()
      const raekker = data.value ?? []
      hentet += raekker.length

      for (const k of raekker) {
        const id = String(k.id ?? '')
        const startIso = String(k.startDateTime ?? '')
        const d = new Date(startIso)
        if (!id || isNaN(d.getTime())) continue

        const type = String(k.callType ?? '')
        const sek  = Number(k.duration ?? 0)

        // Svartid fra trunk-loggen: fra INVITE kom ind til opkaldet blev etableret.
        // Det er den rigtige ventetid for DIREKTE opkald. For opkald via
        // hovednummeret måler den kun at omstillingen svarede (~1 sek), så dem
        // lader vi stå tomme — berigVentetid() henter den rigtige bagefter.
        const invite = new Date(String(k.inviteDateTime ?? ''))
        const vent = !viaBotAf(type) && !isNaN(invite.getTime())
          ? Math.max(0, Math.round((d.getTime() - invite.getTime()) / 1000))
          : null

        // DO UPDATE frem for DO NOTHING: kører vi perioden igen efter en rettelse
        // i klassificeringen, skal de rækker der allerede ligger repareres — ikke
        // springes over. Selve opkaldet er stadig kun gemt én gang (id er Graphs).
        await prisma.$executeRaw`
          INSERT INTO "TeamsCall"
            (id, "startTime", "dagDk", "timeDk", retning, "callType", navn, upn,
             sekunder, besvaret, "viaBot", "sipKode", "slutAarsag",
             "correlationId", "ventSek", "ventKilde")
          VALUES (
            ${id}, ${d}, ${dkFormat.format(d)}, ${Number(dkTime.format(d))},
            ${retningAf(type)}, ${type},
            ${String(k.userDisplayName || k.userPrincipalName || 'ukendt').trim()},
            ${k.userPrincipalName ? String(k.userPrincipalName) : null},
            ${sek}, ${k.successfulCall === true && sek > 0}, ${viaBotAf(type)},
            ${k.finalSipCode ?? null}, ${k.callEndSubReason ?? null},
            ${k.correlationId ? String(k.correlationId) : null},
            ${vent}, ${vent === null ? null : 'trunk'}
          )
          ON CONFLICT (id) DO UPDATE SET
            retning         = EXCLUDED.retning,
            "viaBot"        = EXCLUDED."viaBot",
            sekunder        = EXCLUDED.sekunder,
            besvaret        = EXCLUDED.besvaret,
            "sipKode"       = EXCLUDED."sipKode",
            "slutAarsag"    = EXCLUDED."slutAarsag",
            "correlationId" = EXCLUDED."correlationId",
            -- Rør IKKE en svartid der allerede er beriget fra sessionerne; den er
            -- den rigtige, og trunk-tallet ville overskrive den med ~1 sekund.
            "ventSek"       = CASE WHEN "TeamsCall"."ventKilde" = 'trunk' OR "TeamsCall"."ventKilde" IS NULL
                                   THEN EXCLUDED."ventSek" ELSE "TeamsCall"."ventSek" END,
            "ventKilde"     = CASE WHEN "TeamsCall"."ventKilde" = 'trunk' OR "TeamsCall"."ventKilde" IS NULL
                                   THEN EXCLUDED."ventKilde" ELSE "TeamsCall"."ventKilde" END
        `
        gemt++
      }
      url = data['@odata.nextLink'] ?? null
    }
  }

  return { hentet, gemt }
}

// ─── Ventetid på hovednummer-opkald ─────────────────────────────────────────

/** Navne der er systemer, ikke mennesker — omstilling og kø. */
function erSystemnavn(navn: string): boolean {
  return /_AA$|_CQ$/i.test(navn) || /^hovednummer/i.test(navn)
}

/** Første identitet i sættet der har et rigtigt navn — Graph fylder resten med null. */
function navnFra(identitet: any): string | null {
  for (const v of Object.values(identitet ?? {})) {
    const o = v as any
    if (o && typeof o === 'object' && typeof o.displayName === 'string' && o.displayName.trim()) {
      return o.displayName.trim()
    }
  }
  return null
}

/**
 * Henter den RIGTIGE svartid for opkald gennem hovednummeret.
 *
 * Trunk-loggen viser kun at omstillingen svarede efter ~1 sekund. Kundens
 * faktiske ventetid — menu + kø + ringetid hos medarbejderen — står i
 * callRecord'ets sessioner: opkaldet går først til Hovednummer_AA, så til
 * Hovednummer_CQ, og til sidst dukker der en session op hvor et MENNESKE er på.
 * Tidsforskellen dertil er svaret. Samme session fortæller hvem der tog den,
 * hvilket trunk-loggen heller ikke gør.
 *
 * VIGTIGT: callRecords opbevares kun i 30 dage, mens trunk-loggen har 150. Der
 * kan derfor ikke beriges bagud ud over en måned — men fremad samler det sig,
 * fordi cron kører hver time.
 */
export async function berigVentetid(maksAntal = 400): Promise<{ forsoegt: number; beriget: number; ubesvarede: number }> {
  await ensureSignageSchema()

  const graense = new Date(Date.now() - 29 * 864e5)
  const emner = await prisma.$queryRaw<{ id: string; correlationId: string; startTime: Date }[]>`
    SELECT id, "correlationId", "startTime"
    FROM "TeamsCall"
    WHERE "viaBot" = true
      AND "ventKilde" IS NULL
      AND "correlationId" IS NOT NULL
      AND "startTime" >= ${graense}
    ORDER BY "startTime" DESC
    LIMIT ${maksAntal}
  `
  if (emner.length === 0) return { forsoegt: 0, beriget: 0, ubesvarede: 0 }

  const token = await graphToken()
  let beriget = 0
  let ubesvarede = 0

  for (const e of emner) {
    const res = await fetch(
      `https://graph.microsoft.com/v1.0/communications/callRecords/${e.correlationId}?$expand=sessions`,
      { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, cache: 'no-store' } as any,
    )
    if (res.status === 401 || res.status === 403) {
      throw new TilladelseMangler('CallRecords.Read.All mangler administrator-samtykke')
    }
    if (res.status === 404) {
      // Ude af Microsofts 30-dages vindue, eller aldrig gemt. Markér den, så vi
      // ikke prøver igen i al evighed.
      await prisma.$executeRaw`UPDATE "TeamsCall" SET "ventKilde" = 'utilgaengelig' WHERE id = ${e.id}`
      continue
    }
    if (!res.ok) continue

    const rec = await res.json()
    const sessioner = (rec.sessions ?? []) as any[]
    if (sessioner.length === 0) continue

    const start = Math.min(...sessioner.map(s => +new Date(s.startDateTime)))

    // Den tidligste session hvor et menneske er på. Omstilling og kø hedder
    // Hovednummer_AA/_CQ og skal ikke tælle som "taget telefonen".
    let svar: number | null = null
    let hvem: string | null = null
    for (const s of sessioner) {
      const navn = navnFra(s.caller?.identity) ?? navnFra(s.callee?.identity)
      if (!navn || erSystemnavn(navn)) continue
      // Telefonnumre har intet displayName, så de er allerede sorteret fra.
      const t = +new Date(s.startDateTime)
      if (isNaN(t)) continue
      if (svar === null || t < svar) { svar = t; hvem = navn }
    }

    if (svar === null) {
      await prisma.$executeRaw`
        UPDATE "TeamsCall" SET "ventKilde" = 'ubesvaret' WHERE id = ${e.id}
      `
      ubesvarede++
      continue
    }

    await prisma.$executeRaw`
      UPDATE "TeamsCall"
      SET "ventSek" = ${Math.max(0, Math.round((svar - start) / 1000))},
          "ventKilde" = 'session',
          "besvaretAf" = ${hvem}
      WHERE id = ${e.id}
    `
    beriget++
  }

  return { forsoegt: emner.length, beriget, ubesvarede }
}

// ─── Skærmen ────────────────────────────────────────────────────────────────

/**
 * Læser fra VORES tabel — ikke fra Graph. Skærmen skal være hurtig, og tallene
 * skal blive ved med at findes når Microsofts 150-dages vindue er rullet forbi.
 */
export async function telefoniStat(dato = idagDk()): Promise<TelefoniStat> {
  await ensureSignageSchema()

  const tom: TelefoniStat = {
    dato, ind: 0, ud: 0, ubesvarede: 0, sekunder: 0,
    ventMedian: null, ventP90: null, personer: [], timer: [],
  }

  const raekker = await prisma.$queryRaw<{
    navn: string; besvaretAf: string | null; retning: string; sekunder: number
    timeDk: number; ventSek: number | null; ventKilde: string | null
  }[]>`
    SELECT navn, "besvaretAf", retning, sekunder, "timeDk", "ventSek", "ventKilde"
    FROM "TeamsCall"
    WHERE "dagDk" = ${dato}
  `

  if (raekker.length === 0) {
    // Har vi ALDRIG hentet noget, er det tilladelsen der mangler — ikke en stille dag.
    const [{ antal }] = await prisma.$queryRaw<{ antal: bigint }[]>`
      SELECT count(*) AS antal FROM "TeamsCall"
    `
    if (Number(antal) === 0) {
      return { ...tom, mangler: 'Ingen opkald hentet endnu — mangler CallRecords.Read.All' }
    }
    return tom
  }

  const pr    = new Map<string, TelefoniPerson>()
  const timer = new Map<number, number>()
  const vent: number[] = []
  const ud: TelefoniStat = { ...tom, personer: [], timer: [] }

  for (const r of raekker) {
    const indgaaende = r.retning === 'ind'
    if (indgaaende) ud.ind++; else ud.ud++
    if (r.ventKilde === 'ubesvaret') ud.ubesvarede++
    else if (indgaaende && r.ventSek !== null) vent.push(r.ventSek)
    ud.sekunder += r.sekunder
    timer.set(r.timeDk, (timer.get(r.timeDk) ?? 0) + 1)

    // besvaretAf er den der FAKTISK tog den. På hovednummer-opkald er `navn`
    // bare "Hovednummer_AA" og siger intet om hvem der passede telefonen.
    const navn = (r.besvaretAf ?? r.navn).trim() || 'ukendt'
    const p = pr.get(navn) ?? { navn, ind: 0, ud: 0, sekunder: 0 }
    if (indgaaende) p.ind++; else p.ud++
    p.sekunder += r.sekunder
    pr.set(navn, p)
  }

  ud.ventMedian = median(vent)
  ud.ventP90    = percentil(vent, 0.9)
  ud.personer   = Array.from(pr.values()).sort((a, b) => (b.ind + b.ud) - (a.ind + a.ud))
  ud.timer    = Array.from(timer.entries())
    .map(([time, opkald]) => ({ time, opkald }))
    .sort((a, b) => a.time - b.time)
  return ud
}
