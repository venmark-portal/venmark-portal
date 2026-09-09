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

/** Indgående SMS. Afsender = matchet navn hvis vi kender nummeret, ellers nummeret. */
async function smsBeskeder(): Promise<Besked[]> {
  const raekker = await bcHent('smsLogs', { '$top': '100' })
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

  const url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(bruger)}` +
              `/mailFolders/Inbox/messages?$top=25&$select=subject,receivedDateTime,from&$orderby=receivedDateTime desc`
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' })
  if (!res.ok) throw new Error(`Graph mail ${res.status}: ${(await res.text()).slice(0, 120)}`)

  return ((await res.json()).value ?? []).map((m: any) => ({
    slags: 'mail' as const,
    tid:   String(m.receivedDateTime ?? ''),
    fra:   String(m.from?.emailAddress?.name || m.from?.emailAddress?.address || 'ukendt'),
    tekst: klip(m.subject, 60),
  }))
}

/** Mail, SMS og portal-beskeder blandet sammen efter tid. */
export async function beskedFeed(antal = 20): Promise<BeskedFeed> {
  const kilder: [string, Promise<Besked[]>][] = [
    ['mail',   mailBeskeder()],
    ['sms',    smsBeskeder()],
    ['portal', portalBeskeder()],
  ]

  const beskeder: Besked[] = []
  const mangler:  string[] = []
  for (const [navn, p] of kilder) {
    try { beskeder.push(...await p) }
    catch (e) {
      mangler.push(navn)
      console.error(`[kontor] ${navn}:`, e instanceof Error ? e.message : e)
    }
  }

  return {
    beskeder: beskeder
      .filter(b => b.tid)
      .sort((a, b) => b.tid.localeCompare(a.tid))
      .slice(0, antal),
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
export async function tabteKunder(fra = 7, til = 21, antal = 10): Promise<TabtKunde[]> {
  const dag = (n: number) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10)
  const fakturaer = await bcHent('postedSalesInvoices', {
    '$filter': `postingDate ge ${dag(til + 7)}`,
    '$top':    '5000',
  })

  const sidste = new Map<string, { navn: string; dato: string }>()
  for (const f of fakturaer) {
    const nr = String(f.customerNumber ?? '')
    if (!nr) continue
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
