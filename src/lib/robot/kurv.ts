// Robottens kurv-værktøjer: kundens købshistorik (bogførte fakturalinjer), favoritter og
// den gemte kurv (PortalKurv, samme kurv som bestillingssiden).
//
// Robotten LÆGGER kun i kurven — den sender aldrig en ordre. Kunden ser kurven på
// bestillingssiden og trykker selv "Send bestilling", så frister, lofter og disponibel
// tjekkes præcis som altid. Bestillingssiden slår varerne op forfra ved indlæsning og
// skærer antal ned, der ikke kan leveres.

import type { Tool } from '@anthropic-ai/sdk/resources/messages'
import { getAccessToken, bcPortalBaseUrl, getItemsByNumbers, getItemsUoMs, getCartCoverage } from '@/lib/businesscentral'
import { hentKurv, gemKurv, type KurvLinje } from '@/lib/kurv'
import { oversaetVarenavne } from '@/lib/i18n/portal/varenavne'
import { ymdLokal } from '@/lib/aabenOrdre'
import type { RobotKontekst } from './kontekst'

export const KURV_VAERKTOEJER: Tool[] = [
  {
    name: 'tidligere_koeb',
    description:
      'Kundens køb de seneste uger fra de bogførte fakturaer: hvilke varer, hvor tit, typisk antal og enhed, hvilke ugedage ' +
      '(afsendelsesdag) og senest købt. Brug den til "det plejer jeg", "samme som sidste fredag", eller til at foreslå en kurv.',
    input_schema: {
      type: 'object',
      properties: {
        uger:   { type: 'number', description: 'Antal uger tilbage (standard 8, højst 26)' },
        ugedag: { type: 'string', enum: ['man', 'tir', 'ons', 'tor', 'fre', 'lør', 'søn'], description: 'Kun køb afsendt på denne ugedag' },
      },
    },
  },
  {
    name: 'se_kurv',
    description: 'Det der ligger i kundens kurv på bestillingssiden lige nu.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'laeg_i_kurv',
    description:
      'Læg varer i kundens kurv på bestillingssiden (eller ret antallet). Lægger til det der allerede ligger, medmindre ' +
      'erstat=true. Brug kun varenumre fra et opslag. Sender IKKE ordren — kunden gennemser og sender selv under "Bestil". ' +
      'Har kunden ikke selv bedt om at få lagt i kurven, så vis forslaget og få et ja først.',
    input_schema: {
      type: 'object',
      properties: {
        linjer: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              varenr: { type: 'string' },
              antal:  { type: 'number', description: 'Antal i enheden; 0 fjerner varen fra kurven' },
              enhed:  { type: 'string', description: 'Fx KG, KASSE, STK — udelad for varens basisenhed' },
            },
            required: ['varenr', 'antal'],
          },
        },
        erstat: { type: 'boolean', description: 'true = sæt antallet i stedet for at lægge til' },
      },
      required: ['linjer'],
    },
  },
]

// ── Bogførte fakturalinjer (BC page 50171 postedSalesInvoiceLines) ─────────────

interface FakturaLinje { itemNumber: string; description: string; quantity: number; unitOfMeasureCode: string; postingDate: string }

async function hentFakturaLinjer(customerNo: string, fra: string): Promise<FakturaLinje[]> {
  const token = await getAccessToken()
  const filter = encodeURIComponent(`sellToCustomerNumber eq '${customerNo.replace(/'/g, "''")}' and postingDate ge ${fra}`)
  const sel = '$select=type,itemNumber,description,quantity,unitOfMeasureCode,postingDate'
  const ud: FakturaLinje[] = []
  // Custom API-sider giver ikke altid nextLink — $skip i stedet.
  for (let skip = 0; skip < 20000; skip += 1000) {
    const res = await fetch(`${bcPortalBaseUrl()}/postedSalesInvoiceLines?$filter=${filter}&${sel}&$top=1000&$skip=${skip}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, cache: 'no-store',
    })
    if (!res.ok) throw new Error(`BC fakturalinjer ${res.status}: ${(await res.text()).slice(0, 200)}`)
    const rows: any[] = (await res.json()).value ?? []
    for (const r of rows) {
      if (r.type === 'Item' && r.itemNumber && Number(r.quantity) > 0) {
        ud.push({ itemNumber: r.itemNumber, description: r.description, quantity: Number(r.quantity), unitOfMeasureCode: r.unitOfMeasureCode ?? '', postingDate: r.postingDate })
      }
    }
    if (rows.length < 1000) break
  }
  return ud
}

const UGEDAGE = ['søn', 'man', 'tir', 'ons', 'tor', 'fre', 'lør']

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

async function tidligereKoeb(input: any, ctx: RobotKontekst) {
  const uger = Math.min(26, Math.max(1, Number(input?.uger) || 8))
  const fra = new Date(); fra.setDate(fra.getDate() - uger * 7)
  const ugedag = typeof input?.ugedag === 'string' ? UGEDAGE.indexOf(input.ugedag) : -1
  let linjer = await hentFakturaLinjer(ctx.kunde.customerNo, ymdLokal(fra))
  if (ugedag >= 0) linjer = linjer.filter(l => new Date(`${l.postingDate}T00:00:00`).getDay() === ugedag)
  if (!linjer.length) return { varer: [], besked: `Ingen køb de seneste ${uger} uger${ugedag >= 0 ? ` på ${UGEDAGE[ugedag]}dage` : ''}.` }

  const prVare = new Map<string, FakturaLinje[]>()
  for (const l of linjer) {
    if (!prVare.has(l.itemNumber)) prVare.set(l.itemNumber, [])
    prVare.get(l.itemNumber)!.push(l)
  }
  const varer: any[] = []
  for (const [nr, ls] of Array.from(prVare.entries())) {
    if (!(await ctx.maaSe(nr))) continue
    // Mest brugte enhed — antal i forskellige enheder kan ikke blandes.
    const enhTael = new Map<string, number>()
    for (const l of ls) enhTael.set(l.unitOfMeasureCode, (enhTael.get(l.unitOfMeasureCode) ?? 0) + 1)
    const enhed = Array.from(enhTael.entries()).sort((a, b) => b[1] - a[1])[0][0]
    const iEnhed = ls.filter(l => l.unitOfMeasureCode === enhed)
    const dage = new Map<string, number>()
    for (const l of ls) { const d = UGEDAGE[new Date(`${l.postingDate}T00:00:00`).getDay()]; dage.set(d, (dage.get(d) ?? 0) + 1) }
    varer.push({
      varenr: nr,
      navn: ls[ls.length - 1].description,
      gange: new Set(ls.map(l => l.postingDate)).size,
      typiskAntal: Math.round(median(iEnhed.map(l => l.quantity)) * 10) / 10,
      enhed,
      ugedage: Array.from(dage.entries()).sort((a, b) => b[1] - a[1]).map(([d, n]) => `${d} ${n}`).join(', '),
      senest: ls.map(l => l.postingDate).sort().pop(),
    })
  }
  varer.sort((a, b) => b.gange - a.gange || (b.senest > a.senest ? 1 : -1))
  const oversat = await oversaetVarenavne(varer.map(v => ({ ...v, number: v.varenr, displayName: v.navn })), ctx.kunde.sprog)
  return {
    periode: `seneste ${uger} uger${ugedag >= 0 ? `, kun ${UGEDAGE[ugedag]}dage` : ''}`,
    varer: oversat.slice(0, 40).map(({ number, displayName, ...v }: any) => ({ ...v, navn: displayName })),
  }
}

// ── Kurv ──────────────────────────────────────────────────────────────────────

async function seKurv(ctx: RobotKontekst) {
  const kurv = await hentKurv(ctx.kunde.customerId)
  if (!kurv.linjer.length) return { linjer: [], besked: 'Kurven er tom.' }
  const items = await getItemsByNumbers(kurv.linjer.map(l => l.itemNo)).catch(() => [])
  const oversat = await oversaetVarenavne(items.map(i => ({ ...i })), ctx.kunde.sprog)
  const navn = new Map(oversat.map(i => [i.number, i.displayName]))
  return { linjer: kurv.linjer.map(l => ({ varenr: l.itemNo, navn: navn.get(l.itemNo) ?? '', antal: l.quantity, enhed: l.uom })) }
}

async function laegIKurv(input: any, ctx: RobotKontekst) {
  const oensket: { varenr: string; antal: number; enhed?: string }[] = Array.isArray(input?.linjer)
    ? input.linjer.slice(0, 40).map((l: any) => ({ varenr: String(l?.varenr ?? '').trim(), antal: Number(l?.antal), enhed: l?.enhed ? String(l.enhed).toUpperCase() : undefined }))
    : []
  if (!oensket.length) return { fejl: 'Ingen linjer.' }
  const erstat = input?.erstat === true

  const nos = Array.from(new Set(oensket.map(l => l.varenr)))
  const items = await getItemsByNumbers(nos).catch(() => [])
  const item = new Map(items.map(i => [i.number, i]))
  const uoms = await getItemsUoMs(items.map(i => ({ id: i.id, number: i.number }))).catch(() => new Map())

  const kurv = await hentKurv(ctx.kunde.customerId)
  const linjer = new Map<string, KurvLinje>(kurv.linjer.map(l => [l.itemNo, { ...l }]))
  const resultat: any[] = []

  for (const o of oensket) {
    const i = item.get(o.varenr)
    if (!i || !(await ctx.maaSe(o.varenr))) { resultat.push({ varenr: o.varenr, status: 'findes ikke i kundens sortiment — ikke lagt i kurven' }); continue }
    if (!Number.isFinite(o.antal) || o.antal < 0 || o.antal > 100000) { resultat.push({ varenr: o.varenr, status: 'ugyldigt antal' }); continue }
    const tilladte = [i.baseUnitOfMeasureCode, ...((uoms.get(i.number) ?? []) as any[]).map(u => String(u.code))]
    const enhed = o.enhed && tilladte.includes(o.enhed) ? o.enhed : (linjer.get(o.varenr)?.uom || i.baseUnitOfMeasureCode)
    if (o.enhed && !tilladte.includes(o.enhed)) {
      resultat.push({ varenr: o.varenr, status: `enheden ${o.enhed} findes ikke — brugte ${enhed}. Mulige: ${tilladte.join(', ')}` })
    }
    const eks = linjer.get(o.varenr)
    // Lægger til i samme enhed; skifter enheden, starter linjen forfra i den nye enhed.
    const antal = erstat || !eks || eks.uom !== enhed ? o.antal : eks.quantity + o.antal
    if (antal <= 0) { linjer.delete(o.varenr); resultat.push({ varenr: o.varenr, navn: i.displayName, status: 'fjernet fra kurven' }); continue }
    linjer.set(o.varenr, { itemNo: o.varenr, quantity: Math.round(antal * 1000) / 1000, uom: enhed })
    resultat.push({ varenr: o.varenr, navn: i.displayName, iKurven: `${Math.round(antal * 1000) / 1000} ${enhed}` })
  }

  await gemKurv(ctx.kunde.customerId, Array.from(linjer.values()))
  ctx.kurvAendret = true

  // Advar om det der ikke kan leveres næste leveringsdag — bestillingssiden skærer det ned.
  const [lok, dage, { kundens }] = await Promise.all([ctx.lokation(), ctx.leveringsdage(), ctx.metoder()])
  const dag = dage[0]?.dato
  const tjek = resultat.filter(r => r.iKurven).map(r => r.varenr)
  if (dag && tjek.length) {
    const d = await getCartCoverage(ctx.kunde.customerNo, lok, dag, kundens?.code ?? '', tjek).catch(() => null)
    for (const r of d?.results ?? []) {
      if (r.unlimited || r.maxQty < 0) continue
      const linje = resultat.find(x => x.varenr === r.itemNo)
      if (linje) linje.advarsel = r.maxQty <= 0 ? `udsolgt til ${dag}` : `højst ${r.maxQty} (basisenhed) kan leveres ${dag}`
    }
  }
  return {
    linjer: resultat,
    kurvenNu: Array.from(linjer.values()).length + ' linjer',
    besked: 'Lagt i kurven. Kunden skal selv åbne "Bestil", vælge leveringsdag og sende bestillingen.',
  }
}

export async function koerKurvVaerktoej(navn: string, input: any, ctx: RobotKontekst) {
  switch (navn) {
    case 'tidligere_koeb': return tidligereKoeb(input, ctx)
    case 'se_kurv':        return seKurv(ctx)
    case 'laeg_i_kurv':    return laegIKurv(input, ctx)
    default:               return null
  }
}
