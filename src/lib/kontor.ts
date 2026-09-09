// Data til kontorskærmen: samlet besked-feed, afviste salgslinjer, reklamationer
// og kunder vi er ved at tabe.

import { getAccessToken, bcPortalBaseUrl } from '@/lib/businesscentral'
import { prisma } from '@/lib/prisma'

async function bcHent(sti: string, params: Record<string, string>): Promise<any[]> {
  const token = await getAccessToken()
  const qs = Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')
  const res = await fetch(`${bcPortalBaseUrl()}/${sti}?${qs}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    cache: 'no-store',
  })
  if (!res.ok) throw new Error(`BC ${sti} fejl (${res.status}): ${(await res.text()).slice(0, 160)}`)
  return (await res.json()).value ?? []
}

const klip = (s: string, n: number) => {
  const r = String(s ?? '').replace(/\s+/g, ' ').trim()
  return r.length > n ? r.slice(0, n) + '…' : r
}

// ─── Samlet besked-feed ──────────────────────────────────────────────────────

export type BeskedSlags = 'mail' | 'sms' | 'portal'
export interface Besked {
  slags: BeskedSlags
  tid:   string     // ISO
  fra:   string
  tekst: string
}
export interface BeskedFeed {
  beskeder: Besked[]
  /** Kilder der ikke kunne hentes — vises på skærmen, så tomhed ikke ligner ro. */
  mangler:  string[]
}

/**
 * Indgående SMS. Afsender = matchet navn hvis vi kender nummeret, ellers nummeret.
 *
 * Datofilteret er ikke pynt: BC returnerer i NØGLErækkefølge, så et rent
 * `$top=100` gav de 100 ÆLDSTE poster — feeden viste SMS fra juni, mens dagens
 * lå usete. Samme fælde som udbytterne.
 */
async function smsBeskeder(): Promise<Besked[]> {
  const fra = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 19) + 'Z'
  const raekker = await bcHent('smsLogs', { '$filter': `loggedAt ge ${fra}`, '$top': '1000' })
  return raekker
    .filter(r => String(r.direction ?? '').toLowerCase().startsWith('in'))
    .map(r => ({
      slags: 'sms' as const,
      tid:   String(r.loggedAt ?? ''),
      fra:   String(r.contactName || r.customerName || r.phone || 'ukendt'),
      tekst: klip(r.body, 30),
    }))
}

/** Beskeder fra kunderne i portalen/app'en — ikke dem vi selv har sendt. */
async function portalBeskeder(): Promise<Besked[]> {
  const rows = await prisma.$queryRaw<{ body: string; senderName: string | null; navn: string; createdAt: Date }[]>`
    SELECT m.body, m."senderName", c.name AS navn, m."createdAt"
    FROM "Message" m
    JOIN "Customer" c ON c.id = m."customerId"
    WHERE m.sender = 'customer'
    ORDER BY m."createdAt" DESC
    LIMIT 40
  `
  return rows.map(r => ({
    slags: 'portal' as const,
    tid:   r.createdAt.toISOString(),
    fra:   r.senderName || r.navn,
    tekst: klip(r.body, 60),
  }))
}

/**
 * Indbakken for fisk@venmark.dk via Microsoft Graph.
 *
 * Kræver applikations-tilladelsen Mail.Read + administrator-samtykke, og bør
 * begrænses til netop den postkasse med en Application Access Policy — ellers
 * giver tilladelsen adgang til ALLE postkasser i lejeren.
 * Mangler opsætningen, springes mail over i stedet for at vælte hele feeden.
 */
async function mailBeskeder(): Promise<Besked[]> {
  const bruger = process.env.MAIL_USER
  if (!bruger) throw new Error('MAIL_USER mangler')

  const tenant = process.env.BC_TENANT_ID!
  const id     = process.env.GRAPH_CLIENT_ID     ?? process.env.BC_CLIENT_ID!
  const secret = process.env.GRAPH_CLIENT_SECRET ?? process.env.BC_CLIENT_SECRET!

  const tRes = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    new URLSearchParams({
      grant_type: 'client_credentials', client_id: id, client_secret: secret,
      scope: 'https://graph.microsoft.com/.default',
    }),
    cache: 'no-store',   // aldrig cache et token-svar (heller ikke en 401)
  })
  if (!tRes.ok) throw new Error(`Graph-token ${tRes.status}`)
  const token = (await tRes.json()).access_token

  // Vi henter langt flere end vi skal bruge, fordi det meste sorteres fra: både
  // maskinsvar og alt der har fået en Outlook-kategori.
  // 'String 0x001A' = beskedklassen (PidTagMessageClass) — den afslører kvitteringer.
  const url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(bruger)}` +
              `/mailFolders/Inbox/messages?$top=150` +
              `&$select=subject,receivedDateTime,from,categories,internetMessageHeaders` +
              `&$expand=singleValueExtendedProperties($filter=id eq 'String 0x001A')` +
              `&$orderby=receivedDateTime desc`
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' })
  if (!res.ok) throw new Error(`Graph mail ${res.status}: ${(await res.text()).slice(0, 120)}`)

  return ((await res.json()).value ?? [])
    // En Outlook-kategori betyder at nogen har taget mailen (kategorierne er
    // navne: Line, Nicolai, COOP). Skærmen viser kun det ingen har taget fat i.
    .filter((m: any) => (m.categories ?? []).length === 0)
    .filter((m: any) => !erMaskinsvar(m))
    .map((m: any) => ({
      slags: 'mail' as const,
      tid:   String(m.receivedDateTime ?? ''),
      fra:   String(m.from?.emailAddress?.name || m.from?.emailAddress?.address || 'ukendt'),
      tekst: klip(m.subject, 60) || '(uden emne)',
    }))
}

/**
 * Er mailen et maskinsvar? Bedømmes KUN på tekniske kendetegn — aldrig på
 * emneteksten, for "Automatic reply" kan sagtens stå i en rigtig henvendelse.
 *
 * Bevidst IKKE filtreret: `Precedence: bulk` og `Auto-Submitted: auto-generated`
 * alene. Coops kvittering på en følgeseddel bærer begge dele, men indeholder et
 * sagsnummer man skal kunne se. Det er en for grov kam.
 */
function erMaskinsvar(m: any): boolean {
  // 1) Beskedklassen: REPORT.* er afvisninger og læse-/leveringskvitteringer.
  //    En rigtig mail fra et menneske er altid IPM.Note.
  const klasse = String((m.singleValueExtendedProperties ?? [])[0]?.value ?? '')
  if (klasse.toUpperCase().startsWith('REPORT.')) return true

  const h: { name: string; value: string }[] = m.internetMessageHeaders ?? []
  const find = (navn: string) =>
    h.find(x => x.name?.toLowerCase() === navn.toLowerCase())?.value?.toLowerCase() ?? ''

  // 2) RFC 3834: 'auto-replied' sættes af autosvar. Mennesker sætter den aldrig.
  if (find('auto-submitted').includes('auto-replied')) return true

  // 3) Exchange sætter denne på fraværsassistentens svar.
  if (h.some(x => x.name?.toLowerCase() === 'x-auto-response-suppress')) return true

  return false
}

/** Mail, SMS og portal-beskeder blandet sammen efter tid. */
export async function beskedFeed(antal = 20): Promise<BeskedFeed> {
  const kilder: [string, Promise<Besked[]>][] = [
    ['mail',   mailBeskeder()],
    ['sms',    smsBeskeder()],
    ['portal', portalBeskeder()],
  ]

  const perKilde = new Map<string, Besked[]>()
  const mangler:  string[] = []
  for (const [navn, p] of kilder) {
    try {
      const r = (await p).filter(b => b.tid).sort((a, b) => b.tid.localeCompare(a.tid))
      perKilde.set(navn, r)
    } catch (e) {
      mangler.push(navn)
      console.error(`[kontor] ${navn}:`, e instanceof Error ? e.message : e)
    }
  }

  // Hver kilde får en garanteret andel af pladserne først. Uden det fortrænger
  // mailen alt andet: indbakken får mange mails om dagen, mens der kan gå uger
  // mellem to SMS — og så var de aldrig at se, selvom de er vigtige.
  const aktive = Array.from(perKilde.values()).filter(v => v.length > 0)
  const kvote  = aktive.length > 0 ? Math.max(1, Math.floor(antal / aktive.length)) : antal

  const valgt: Besked[] = []
  const rest:  Besked[] = []
  for (const liste of perKilde.values()) {
    valgt.push(...liste.slice(0, kvote))
    rest.push(...liste.slice(kvote))
  }

  // Resten af pladserne går til de nyeste uanset kilde.
  rest.sort((a, b) => b.tid.localeCompare(a.tid))
  valgt.push(...rest.slice(0, Math.max(0, antal - valgt.length)))

  return {
    beskeder: valgt.sort((a, b) => b.tid.localeCompare(a.tid)).slice(0, antal),
    mangler,
  }
}

// ─── Afviste salgslinjer ─────────────────────────────────────────────────────

export interface AfvistLinje {
  tid: string; saelger: string; kunde: string; vare: string; oversolgt: number; ordre: string
}

export async function afvisteLinjer(antal = 15): Promise<AfvistLinje[]> {
  const raekker = await bcHent('afvistLines', { '$top': '500' })
  return raekker
    .map(r => ({
      tid:       `${String(r.entryDate ?? '').slice(0, 10)}T${String(r.entryTime ?? '').slice(11, 19) || '00:00:00'}`,
      saelger:   String(r.sellerUserId ?? ''),
      kunde:     String(r.customerName || r.customerNo || ''),
      vare:      String(r.itemDescription || r.itemNo || ''),
      oversolgt: Number(r.qtyOversold ?? 0),
      ordre:     String(r.orderNo ?? ''),
      _nr:       Number(r.entryNo ?? 0),
    }))
    .sort((a: any, b: any) => b._nr - a._nr)
    .slice(0, antal)
    .map(({ _nr, ...r }: any) => r)
}

// ─── Reklamationer ───────────────────────────────────────────────────────────

export interface Reklamation {
  emne: string; kunde: string; status: string; tid: string
}

export async function nyesteReklamationer(antal = 3): Promise<Reklamation[]> {
  const rows = await prisma.$queryRaw<{ subject: string; navn: string; status: string; createdAt: Date }[]>`
    SELECT t.subject, c.name AS navn, t.status, t."createdAt"
    FROM "Ticket" t
    JOIN "Customer" c ON c.id = t."customerId"
    WHERE t.type = 'COMPLAINT'
    ORDER BY t."createdAt" DESC
    LIMIT ${antal}
  `
  return rows.map(r => ({
    emne: klip(r.subject, 50), kunde: r.navn, status: r.status, tid: r.createdAt.toISOString(),
  }))
}

// ─── Kunder vi er ved at tabe ────────────────────────────────────────────────

export interface TabtKunde {
  kundeNr: string; navn: string; sidsteKoeb: string; dage: number
}

/**
 * Kunder hvis SENESTE faktura ligger mellem `fra` og `til` dage tilbage.
 * "Det er der vi taber dem" — Claus.
 *
 * Sidste køb = seneste bogførte salgsfaktura, samme definition som BC's eget
 * kunde-tjek ved ordreoprettelse (Cust. Ledger Entry, Document Type = Invoice).
 * Vi henter et vindue der er bredere end `til`, så en kunde der købte for nylig
 * ikke fejlagtigt ser ud til at være væk.
 */
export async function tabteKunder(fra = 7, til = 21, antal = 60): Promise<TabtKunde[]> {
  const dag = (n: number) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10)
  const fakturaer = await bcHent('postedSalesInvoices', {
    '$filter': `postingDate ge ${dag(til + 7)}`,
    '$top':    '5000',
  })

  // Personalet handler som privatkunder og skal ikke med. De kendes udelukkende
  // på DEBITORBOGFØRINGSGRUPPEN PERSONALE (Claus) — ikke prisgruppen, for den
  // kan en rigtig kunde også have. Hverken navn eller kundenummer røber det.
  // Kan gruppen ikke hentes, viser vi hellere for meget end at skjule en rigtig
  // kunde i tavshed.
  const personale = new Set<string>()
  try {
    for (const c of await bcHent('customerGroups', { '$top': '5000' })) {
      if (String(c.postingGroup ?? '').trim().toUpperCase() === 'PERSONALE') {
        personale.add(String(c.number))
      }
    }
  } catch (e) {
    console.error('[kontor] customerGroups:', e instanceof Error ? e.message : e)
  }

  const sidste = new Map<string, { navn: string; dato: string }>()
  for (const f of fakturaer) {
    const nr = String(f.customerNumber ?? '')
    if (!nr || personale.has(nr)) continue
    const dato = String(f.postingDate ?? '').slice(0, 10)
    const kendt = sidste.get(nr)
    if (!kendt || dato > kendt.dato) sidste.set(nr, { navn: String(f.customerName ?? nr), dato })
  }

  const idag = new Date(new Date().toISOString().slice(0, 10)).getTime()
  const ud: TabtKunde[] = []
  for (const [nr, k] of Array.from(sidste)) {
    const dage = Math.round((idag - new Date(k.dato).getTime()) / 864e5)
    if (dage >= fra && dage <= til) ud.push({ kundeNr: nr, navn: k.navn, sidsteKoeb: k.dato, dage })
  }

  // Længst væk først — dem er vi tættest på at miste.
  return ud.sort((a, b) => b.dage - a.dage).slice(0, antal)
}
