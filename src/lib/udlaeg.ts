// Udlæg/bilag fra medarbejder-appen (/bilag). Medarbejderen fotograferer en kvittering,
// portalen laver en PDF og mailer den til bilagsmailen (Venmark Opsætning → videresendes
// til Expense720). Hvert bilag registreres i BC først (tabel "VM Udlaeg") — det giver
// bilags-ID'et, som står i PDF'en, filnavnet og mailemnet.
//
// Adgang: kreditoren i BC skal have "Bilag tilladt" og "App-e-mail" = medarbejderens login.

import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getAccessToken, bcPortalBaseUrl } from '@/lib/businesscentral'
import { hentMedarbejder } from '@/lib/medarbejder'

export interface UdlaegBruger { vendorNo: string; navn: string; email: string }
export interface UdlaegKonto { kontoNr: string; tekst: string; forklaring: string; repraesentation: boolean }
export interface Firmakort { kode: string; beskrivelse: string; bankkonto: string; kortholder: string }

async function bcGet<T>(sti: string): Promise<T[]> {
  const token = await getAccessToken()
  const res = await fetch(`${bcPortalBaseUrl()}/${sti}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  })
  if (!res.ok) {
    const txt = await res.text().catch(() => '')
    console.error('[udlaeg] BC GET', sti, res.status, txt.slice(0, 300))
    throw new Error(`BC svarede ${res.status} på ${sti.split('?')[0]}`)
  }
  return ((await res.json()).value ?? []) as T[]
}

// Kreditorer med Bilag tilladt ændrer sig sjældent — 5 min. cache sparer et BC-kald pr. side.
let brugerCache: { tid: number; liste: UdlaegBruger[] } | null = null

async function alleBrugere(): Promise<UdlaegBruger[]> {
  if (brugerCache && Date.now() - brugerCache.tid < 5 * 60_000) return brugerCache.liste
  const rows = await bcGet<any>('udlaegBrugere')
  const liste = rows
    .filter(r => !String(r.blocked ?? '').trim() || r.blocked === '_x0020_')
    .map(r => ({ vendorNo: r.number, navn: r.name, email: String(r.appEmail ?? '').trim().toLowerCase() }))
    .filter(r => r.email)
  brugerCache = { tid: Date.now(), liste }
  return liste
}

/** Den indloggede medarbejders kreditor, hvis vedkommende må sende bilag — ellers null. */
export async function udlaegBrugerFraSession(): Promise<UdlaegBruger | null> {
  const session = await getServerSession(authOptions)
  const mId = (session?.user as any)?.medarbejder?.id as string | undefined
  if (!mId) return null
  const m = await hentMedarbejder(mId).catch(() => null)
  if (!m?.aktiv || !m.email) return null
  const email = m.email.trim().toLowerCase()
  return (await alleBrugere()).find(b => b.email === email) ?? null
}

export async function hentKonti(): Promise<UdlaegKonto[]> {
  const rows = await bcGet<any>('udlaegKonti')
  return rows
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
    .map(r => ({ kontoNr: r.accountNo, tekst: r.appText || r.accountNo, forklaring: r.explanation ?? '', repraesentation: !!r.representation }))
}

/** Fælleskort (uden kortholder) + medarbejderens egne kort. */
export async function hentFirmakort(vendorNo: string): Promise<Firmakort[]> {
  const rows = await bcGet<any>('firmakort')
  return rows
    .filter(r => !r.holderVendorNo || r.holderVendorNo === vendorNo)
    .map(r => ({ kode: r.code, beskrivelse: r.description || r.code, bankkonto: r.bankAccountNo ?? '', kortholder: r.holderVendorNo ?? '' }))
}

export async function hentBilagsmail(): Promise<string> {
  const rows = await bcGet<any>('udlaegOpsaetning')
  return String(rows[0]?.bilagsmail ?? '').trim()
}

/** Tidligere bilag fra samme person med samme dato og beløb (dublet-advarsel). */
export async function findDubletter(vendorNo: string, dato: string, beloeb: number): Promise<{ bilagId: string; merchant: string }[]> {
  const f = `vendorNo eq '${vendorNo.replace(/'/g, "''")}' and purchaseDate eq ${dato} and amountInclVat eq ${beloeb}`
  const rows = await bcGet<any>(`udlaeg?$filter=${encodeURIComponent(f)}`)
  return rows.filter(r => r.mailSent).map(r => ({ bilagId: r.bilagId, merchant: r.merchant }))
}

export interface NytUdlaeg {
  vendorNo: string
  vendorName: string
  paidWith: 'Privat' | 'Firmakort'
  cardCode: string
  bankAccountNo: string
  accountNo: string          // '' = Ved ikke
  purchaseDate: string       // yyyy-mm-dd
  merchant: string
  merchantVatNo: string
  amountInclVat: number
  vatAmount: number
  currencyCode: string
  purpose: string
  participants: string
  submittedBy: string
  pageCount: number
}

export async function opretUdlaeg(u: NytUdlaeg): Promise<{ id: string; bilagId: string }> {
  const token = await getAccessToken()
  const res = await fetch(`${bcPortalBaseUrl()}/udlaeg`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...u, mailSent: false }),
    cache: 'no-store',
  })
  const txt = await res.text()
  if (!res.ok) {
    console.error('[udlaeg] opret', res.status, txt.slice(0, 500))
    throw new Error(`Bilaget kunne ikke registreres i BC (${res.status})`)
  }
  const r = JSON.parse(txt)
  return { id: r.id, bilagId: r.bilagId }
}

export async function markerMailet(id: string): Promise<void> {
  const token = await getAccessToken()
  const res = await fetch(`${bcPortalBaseUrl()}/udlaeg(${id})`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'If-Match': '*' },
    body: JSON.stringify({ mailSent: true }),
    cache: 'no-store',
  })
  if (!res.ok) console.error('[udlaeg] markér mailet', id, res.status, (await res.text().catch(() => '')).slice(0, 300))
}
