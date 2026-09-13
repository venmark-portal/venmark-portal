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
  /** Opkald der aldrig blev besvaret. */
  ubesvarede: number
  sekunder:   number
  personer:   TelefoniPerson[]
  timer:      TelefoniTime[]
  /** Sat når tilladelsen mangler — så siger skærmen det i stedet for at vise 0. */
  mangler?:   string
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
        // duration sættes kun når opkaldet blev forbundet. Er det tomt, blev der
        // aldrig taget telefonen — det tal er mindst lige så interessant som minutterne.
        const sek = Number(k.duration ?? 0)

        // DO UPDATE frem for DO NOTHING: kører vi perioden igen efter en rettelse
        // i klassificeringen, skal de rækker der allerede ligger repareres — ikke
        // springes over. Selve opkaldet er stadig kun gemt én gang (id er Graphs).
        await prisma.$executeRaw`
          INSERT INTO "TeamsCall"
            (id, "startTime", "dagDk", "timeDk", retning, "callType", navn, upn,
             sekunder, besvaret, "viaBot", "sipKode", "slutAarsag")
          VALUES (
            ${id}, ${d}, ${dkFormat.format(d)}, ${Number(dkTime.format(d))},
            ${retningAf(type)}, ${type},
            ${String(k.userDisplayName || k.userPrincipalName || 'ukendt').trim()},
            ${k.userPrincipalName ? String(k.userPrincipalName) : null},
            ${sek}, ${k.successfulCall === true && sek > 0}, ${viaBotAf(type)},
            ${k.finalSipCode ?? null}, ${k.callEndSubReason ?? null}
          )
          ON CONFLICT (id) DO UPDATE SET
            retning      = EXCLUDED.retning,
            "viaBot"     = EXCLUDED."viaBot",
            sekunder     = EXCLUDED.sekunder,
            besvaret     = EXCLUDED.besvaret,
            "sipKode"    = EXCLUDED."sipKode",
            "slutAarsag" = EXCLUDED."slutAarsag"
        `
        gemt++
      }
      url = data['@odata.nextLink'] ?? null
    }
  }

  return { hentet, gemt }
}

// ─── Skærmen ────────────────────────────────────────────────────────────────

/**
 * Læser fra VORES tabel — ikke fra Graph. Skærmen skal være hurtig, og tallene
 * skal blive ved med at findes når Microsofts 150-dages vindue er rullet forbi.
 */
export async function telefoniStat(dato = idagDk()): Promise<TelefoniStat> {
  await ensureSignageSchema()

  const tom: TelefoniStat = { dato, ind: 0, ud: 0, ubesvarede: 0, sekunder: 0, personer: [], timer: [] }

  const raekker = await prisma.$queryRaw<{
    navn: string; retning: string; sekunder: number; besvaret: boolean; timeDk: number
  }[]>`
    SELECT navn, retning, sekunder, besvaret, "timeDk"
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
  const ud: TelefoniStat = { ...tom, personer: [], timer: [] }

  for (const r of raekker) {
    const indgaaende = r.retning === 'ind'
    if (indgaaende) ud.ind++; else ud.ud++
    if (!r.besvaret) ud.ubesvarede++
    ud.sekunder += r.sekunder
    timer.set(r.timeDk, (timer.get(r.timeDk) ?? 0) + 1)

    const p = pr.get(r.navn) ?? { navn: r.navn, ind: 0, ud: 0, sekunder: 0 }
    if (indgaaende) p.ind++; else p.ud++
    p.sekunder += r.sekunder
    pr.set(r.navn, p)
  }

  ud.personer = Array.from(pr.values()).sort((a, b) => (b.ind + b.ud) - (a.ind + a.ud))
  ud.timer    = Array.from(timer.entries())
    .map(([time, opkald]) => ({ time, opkald }))
    .sort((a, b) => a.time - b.time)
  return ud
}
