// Robottens værktøjer — det eneste den kan slå op eller gøre. Alt kører som den indloggede
// kunde (RobotKontekst): kundens priser, kundens leveringsform, kundens ordrer. Robotten
// kan ikke spørge til andre kunder, fordi kundenummeret aldrig er et input.
//
// Første trin er kun læsning + "send til kontoret". Robotten lægger ikke i kurven og
// opretter ikke ordrer.
//
// Svarene er kompakt JSON. Robotten får dem ordret, så hold dem korte: hver ekstra
// linje betales ved hvert efterfølgende kald i samme svar.

import { randomUUID } from 'crypto'
import type { Tool } from '@anthropic-ai/sdk/resources/messages'
import { prisma } from '@/lib/prisma'
import {
  getItemsByNumbers, getItemAvailabilities, getCartCoverage, getItemsUoMs,
  getItemsAttributeValues, getCustomerOrders, getPortalLineStatuses, getCustomerFavorites,
  getStandingOrderLines, getItemCutoffs, pushBeskedTilBC, flagBeskedUlaest,
  type BCItem, type BCItemAvailability,
} from '@/lib/businesscentral'
import { oversaetVarenavne } from '@/lib/i18n/portal/varenavne'
import { bcOrdreLevering } from '@/lib/tilfoejOrdre'
import { ymdLokal } from '@/lib/aabenOrdre'
import { addBusinessDays } from '@/lib/dateUtils'
import { RobotKontekst, prisFor, trappeFor } from './kontekst'
import { soegKatalog } from '@/lib/katalogSoeg'

const MAX_VARER = 12

export const VAERKTOEJER: Tool[] = [
  {
    name: 'soeg_varer',
    description:
      'Søg i Venmarks sortiment efter varer kunden kan bestille. Søg på fiskeart, produkt, oprindelse eller leverandør ' +
      '(fx "torsk", "laks røget", "laks bakka", "rejer") eller et varenummer. Alle ord skal passe, store/små bogstaver er ligegyldige. ' +
      'Giver varenr., navn, kundens pris og hvor meget der kan leveres på leveringsdatoen (standard: kundens næste leveringsdag) ' +
      'samt bestillingsfristen — så du ikke behøver kalde leveringsdage/kan_leveres bagefter. Finder du intet, så prøv færre eller andre ord.',
    input_schema: {
      type: 'object',
      properties: {
        soegeord:      { type: 'string', description: 'Søgeord, fx "torsk" eller "laks bakka" — eller et varenummer' },
        leveringsdato: { type: 'string', description: 'Valgfri YYYY-MM-DD; udelad for næste leveringsdag' },
      },
      required: ['soegeord'],
    },
  },
  {
    name: 'dagens_anbefalinger',
    description:
      'Dagens tilbud og varer Venmark anbefaler lige nu (fx dagens fangst fra auktionen), med kundens pris og hvad der kan leveres ' +
      'næste leveringsdag. Brug den når kunden spørger efter noget godt, noget særligt til disken, nyheder eller "hvad har I i dag".',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'vare_detaljer',
    description:
      'Detaljer om bestemte varer: trappepriser, hvilke enheder varen kan bestilles i (kasse, spand …), egenskaber som MSC/ASC, ' +
      'og Venmarks tekst om varen. Brug varenumre fra en søgning.',
    input_schema: {
      type: 'object',
      properties: { varenumre: { type: 'array', items: { type: 'string' }, description: 'Op til 12 varenumre' } },
      required: ['varenumre'],
    },
  },
  {
    name: 'kan_leveres',
    description:
      'Hvor meget af nogle varer der kan leveres til kunden på en bestemt leveringsdato — samme beregning som bestillingssiden. ' +
      'Brug den før du siger, at noget kan leveres en anden dag end den næste leveringsdag.',
    input_schema: {
      type: 'object',
      properties: {
        varenumre:     { type: 'array', items: { type: 'string' } },
        leveringsdato: { type: 'string', description: 'YYYY-MM-DD — skal være en af kundens leveringsdage' },
      },
      required: ['varenumre', 'leveringsdato'],
    },
  },
  {
    name: 'leveringsdage',
    description: 'Kundens næste leveringsdage og bestillingsfristen for hver (dato og klokkeslæt).',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'mine_ordrer',
    description:
      'Kundens åbne (ikke-fakturerede) ordrer med leveringsdato og linjer: vare, antal, status (Godkendt/Afventer/Afvist) og om den er pakket.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'mine_favoritter',
    description: 'Kundens favoritvarer og faste ugentlige ordrelinjer.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'send_til_kontoret',
    description:
      'Send en besked til Venmarks kontor i kundens navn — fx når kunden vil ringes op, har et problem du ikke kan løse, ' +
      'eller spørger om noget du ikke ved. Spørg ALTID kunden om lov og vis beskeden først. Beskeden lander under Beskeder i portalen og hos kontoret.',
    input_schema: {
      type: 'object',
      properties: { besked: { type: 'string', description: 'Kort og klar besked til kontoret, skrevet på dansk' } },
      required: ['besked'],
    },
  },
]

type VaerktoejSvar = Record<string, unknown> | unknown[]

export async function koerVaerktoej(navn: string, input: any, ctx: RobotKontekst): Promise<VaerktoejSvar> {
  switch (navn) {
    case 'soeg_varer':          return soegVarer(String(input?.soegeord ?? ''), String(input?.leveringsdato ?? ''), ctx)
    case 'dagens_anbefalinger': return dagensAnbefalinger(ctx)
    case 'vare_detaljer':       return vareDetaljer(arr(input?.varenumre), ctx)
    case 'kan_leveres':         return kanLeveres(arr(input?.varenumre), String(input?.leveringsdato ?? ''), ctx)
    case 'leveringsdage':       return leveringsdage(ctx)
    case 'mine_ordrer':         return mineOrdrer(ctx)
    case 'mine_favoritter':     return mineFavoritter(ctx)
    case 'send_til_kontoret':   return sendTilKontoret(String(input?.besked ?? ''), ctx)
    default:                    return { fejl: `Ukendt værktøj: ${navn}` }
  }
}

function arr(v: unknown): string[] {
  return Array.isArray(v) ? v.map(String).filter(Boolean).slice(0, MAX_VARER) : []
}

const idag = () => ymdLokal(new Date())

// ── Fælles: varekort → kompakt linje med pris og levering næste leveringsdag ──

async function varelinjer(items: BCItem[], ctx: RobotKontekst, noter: Map<string, string> = new Map(), dato = '') {
  const synlige: BCItem[] = []
  for (const i of items) if (await ctx.maaSe(i.number)) synlige.push(i)
  const valgte = synlige.slice(0, MAX_VARER)
  if (!valgte.length) return { varer: [] }

  const nos = valgte.map(i => i.number)
  const [priser, lok, dage, { kundens }] = await Promise.all([
    ctx.priser(), ctx.lokation(), ctx.leveringsdage(20), ctx.metoder(),
  ])
  const dag = (dato && dage.find(x => x.dato === dato)) || dage[0]
  if (dato && dag?.dato !== dato) {
    return { fejl: `${dato} er ikke en leveringsdag for kunden.`, muligeDage: dage.slice(0, 8).map(x => x.dato) }
  }
  const naeste = dag?.dato ?? ''
  const [disp, daekning, oversat] = await Promise.all([
    getItemAvailabilities(lok, nos).catch(() => new Map<string, BCItemAvailability>()),
    naeste
      ? getCartCoverage(ctx.kunde.customerNo, lok, naeste, kundens?.code ?? '', nos).catch(() => null)
      : Promise.resolve(null),
    oversaetVarenavne(valgte.map(i => ({ ...i })), ctx.kunde.sprog),
  ])
  const maks = new Map((daekning?.results ?? []).map(r => [r.itemNo, r.unlimited ? -1 : r.maxQty]))
  const d = idag()

  return {
    leveringsdato: naeste || null,
    ...(dag ? { bestilSenest: fristTekst(dag.frist) } : {}),
    varer: oversat.map(i => {
      const p = prisFor(i.number, priser, d)
      const a = disp.get(i.number)
      const m = maks.get(i.number)
      return {
        varenr: i.number,
        navn:   i.displayName,
        pris:   p ? `${p.pris.toFixed(2)} kr./${p.enhed || i.baseUnitOfMeasureCode}` : 'ingen fast pris — dagspris, spørg kontoret',
        basisenhed: i.baseUnitOfMeasureCode,
        kanLeveres:
          m === undefined ? 'ukendt' : m < 0 ? 'ja, intet loft' : m <= 0 ? 'nej, udsolgt til den dag' : `op til ${m} ${i.baseUnitOfMeasureCode}`,
        ...(a?.strengtLager && (a.disponibelt ?? 0) <= 0 && a.naesteLevering ? { igenFra: a.naesteLevering } : {}),
        ...(a?.daekketFra && m !== undefined && m >= 0 ? { ubegraensetFra: a.daekketFra } : {}),
        ...(a?.statusNote ? { note: a.statusNote } : {}),
        ...(noter.get(i.number) ? { tilbud: noter.get(i.number) } : {}),
      }
    }),
  }
}

// ── soeg_varer ────────────────────────────────────────────────────────────────

async function soegVarer(q: string, dato: string, ctx: RobotKontekst) {
  q = q.trim()
  if (q.length < 2) return { fejl: 'Søgeordet er for kort.' }
  const fundne = await soegKatalog(q, ctx.kunde.sprog)
  // Kun varer kunden må se — og dem med en pris til kunden først (de er i kundens sortiment).
  const [priser, synlige] = await Promise.all([ctx.priser(), Promise.all(fundne.map(n => ctx.maaSe(n)))])
  const harPris = new Set(priser.map(p => p.itemNo))
  const tilladte = fundne.filter((_, i) => synlige[i])
  const sorteret = [...tilladte.filter(n => harPris.has(n)), ...tilladte.filter(n => !harPris.has(n))]
  if (!sorteret.length) return { varer: [], besked: `Ingen varer fundet for "${q}". Prøv færre eller andre ord.` }
  const items = await getItemsByNumbers(sorteret.slice(0, MAX_VARER)).catch(() => [] as BCItem[])
  const orden = new Map(sorteret.map((n, i) => [n, i]))
  items.sort((a, b) => (orden.get(a.number) ?? 99) - (orden.get(b.number) ?? 99))
  const svar = await varelinjer(items, ctx, new Map(), /^\d{4}-\d{2}-\d{2}$/.test(dato) ? dato : '')
  return sorteret.length > MAX_VARER
    ? { ...svar, flere: `${sorteret.length - MAX_VARER} varer mere matcher — spørg kunden om størrelse/type, eller søg mere præcist.` }
    : svar
}

// ── dagens_anbefalinger ───────────────────────────────────────────────────────

async function dagensAnbefalinger(ctx: RobotKontekst) {
  const start = new Date(new Date().toDateString())
  const [promos, cutoffs] = await Promise.all([
    prisma.dailyPromotion.findMany({
      where: { date: { gte: start, lt: addBusinessDays(start, 1) } },
      orderBy: { priority: 'desc' },
    }).catch(() => []),
    getItemCutoffs().catch(() => new Map()),
  ])
  const noter = new Map(promos.map(p => [p.bcItemNumber, p.note || 'dagens tilbud']))
  const anbefalet = Array.from(cutoffs.entries()).filter(([, v]: any) => v.saelgForH).map(([nr]) => nr as string)
  const nos = Array.from(new Set([...promos.map(p => p.bcItemNumber), ...anbefalet]))
  if (!nos.length) return { varer: [], besked: 'Ingen særlige tilbud eller anbefalinger i dag.' }
  const items = await getItemsByNumbers(nos).catch(() => [])
  // Tilbud først, så anbefalinger i den rækkefølge kontoret har prioriteret dem.
  const orden = new Map(nos.map((n, i) => [n, i]))
  items.sort((a, b) => (orden.get(a.number) ?? 99) - (orden.get(b.number) ?? 99))
  return varelinjer(items, ctx, noter)
}

// ── vare_detaljer ─────────────────────────────────────────────────────────────

async function vareDetaljer(nos: string[], ctx: RobotKontekst) {
  const tilladte: string[] = []
  for (const n of nos) if (await ctx.maaSe(n)) tilladte.push(n)
  if (!tilladte.length) return { varer: [], besked: 'Ingen af varenumrene findes i kundens sortiment.' }
  const items = await getItemsByNumbers(tilladte).catch(() => [])
  const refs = items.map(i => ({ id: i.id, number: i.number }))
  const [priser, lok, uoms, attrs, oversat] = await Promise.all([
    ctx.priser(), ctx.lokation(),
    getItemsUoMs(refs).catch(() => new Map()),
    getItemsAttributeValues(refs).catch(() => new Map()),
    oversaetVarenavne(items.map(i => ({ ...i })), ctx.kunde.sprog),
  ])
  const disp = await getItemAvailabilities(lok, tilladte).catch(() => new Map<string, BCItemAvailability>())
  const d = idag()
  return {
    varer: oversat.map(i => {
      const p = prisFor(i.number, priser, d)
      const a = disp.get(i.number)
      return {
        varenr: i.number,
        navn:   i.displayName,
        pris:   p ? `${p.pris.toFixed(2)} kr./${p.enhed || i.baseUnitOfMeasureCode}` : 'ingen fast pris',
        trappepriser: trappeFor(i.number, priser, d).map(t => `fra ${t.fraAntal} ${t.enhed}: ${t.pris.toFixed(2)} kr.`),
        enheder: ((uoms.get(i.number) ?? []) as any[]).map(u => `${u.code} = ${u.qtyPerUnitOfMeasure} ${i.baseUnitOfMeasureCode}`),
        egenskaber: ((attrs.get(i.number) ?? []) as any[]).filter(x => x.value).map(x => `${x.attributeName}: ${x.value}`),
        ...(a?.danskTekstPrisliste ? { beskrivelse: a.danskTekstPrisliste } : {}),
        ...(a?.statusNote ? { note: a.statusNote } : {}),
      }
    }),
  }
}

// ── kan_leveres ───────────────────────────────────────────────────────────────

async function kanLeveres(nos: string[], dato: string, ctx: RobotKontekst) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dato)) return { fejl: 'leveringsdato skal være YYYY-MM-DD' }
  const dage = await ctx.leveringsdage(20)
  const dag = dage.find(x => x.dato === dato)
  if (!dag) return { fejl: `${dato} er ikke en leveringsdag for kunden.`, muligeDage: dage.slice(0, 8).map(x => x.dato) }
  const tilladte: string[] = []
  for (const n of nos) if (await ctx.maaSe(n)) tilladte.push(n)
  if (!tilladte.length) return { varer: [] }
  const [lok, { kundens }] = await Promise.all([ctx.lokation(), ctx.metoder()])
  const daekning = await getCartCoverage(ctx.kunde.customerNo, lok, dato, kundens?.code ?? '', tilladte).catch(() => null)
  if (!daekning) return { fejl: 'Kunne ikke beregne det lige nu. Henvis til bestillingssiden.' }
  return {
    leveringsdato: dato,
    bestillingsfrist: fristTekst(dag.frist),
    varer: daekning.results.map(r => ({
      varenr: r.itemNo,
      kanLeveres: r.unlimited || r.maxQty < 0 ? 'ja, intet loft' : r.maxQty <= 0 ? 'nej, udsolgt til den dag' : `op til ${r.maxQty}`,
    })),
  }
}

// ── leveringsdage ─────────────────────────────────────────────────────────────

function fristTekst(d: Date): string {
  return d.toLocaleString('da-DK', {
    timeZone: 'Europe/Copenhagen', weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit',
  })
}

async function leveringsdage(ctx: RobotKontekst) {
  const [dage, { kundens }] = await Promise.all([ctx.leveringsdage(8), ctx.metoder()])
  return {
    leveringsform: kundens?.description ?? kundens?.code ?? 'ukendt',
    dage: dage.map(d => ({ levering: d.dato, bestilSenest: fristTekst(d.frist) })),
  }
}

// ── mine_ordrer ───────────────────────────────────────────────────────────────

async function mineOrdrer(ctx: RobotKontekst) {
  const [ordrer, { alle }] = await Promise.all([
    getCustomerOrders(ctx.kunde.customerNo).catch(() => []),
    ctx.metoder(),
  ])
  if (!ordrer.length) return { ordrer: [], besked: 'Kunden har ingen åbne ordrer.' }
  const udvalg = ordrer.slice(0, 8)
  const linjer = await Promise.all(udvalg.map(o => getPortalLineStatuses(o.number, { frisk: true }).then(l => l ?? []).catch(() => [])))
  return {
    ordrer: udvalg.map((o, i) => ({
      ordrenr:       o.number,
      levering:      bcOrdreLevering(o, linjer[i].map(l => l.shipmentDate), alle) || null,
      leveringsform: o.shipmentMethodName || o.shipmentMethodCode,
      reference:     o.externalDocumentNumber || undefined,
      faerdigpakket: linjer[i].some(l => l.headerPackedBy) || undefined,
      linjer: linjer[i].map(l => ({
        vare:   l.description,
        antal:  `${l.quantity} ${l.unitOfMeasureCode}`,
        status: l.portalLineStatus,
        ...(l.packedBy ? { pakket: true } : {}),
      })),
    })),
  }
}

// ── mine_favoritter ───────────────────────────────────────────────────────────

async function mineFavoritter(ctx: RobotKontekst) {
  const [fav, faste] = await Promise.all([
    getCustomerFavorites(ctx.kunde.customerNo).catch(() => []),
    getStandingOrderLines(ctx.kunde.customerNo).catch(() => []),
  ])
  const vis = async <T extends { itemNo: string }>(l: T[]) => {
    const ud: T[] = []; for (const x of l) if (await ctx.maaSe(x.itemNo)) ud.push(x); return ud
  }
  return {
    favoritter: (await vis(fav.filter(f => f.active !== false))).map(f => ({
      varenr: f.itemNo, navn: f.description, ...(f.standardFavorite ? { standard: true } : {}),
    })),
    fasteUgentlige: (await vis(faste)).map(l => ({
      varenr: l.itemNo, enhed: l.unitOfMeasureCode,
      man: l.qtyMonday, tir: l.qtyTuesday, ons: l.qtyWednesday, tor: l.qtyThursday, fre: l.qtyFriday,
    })),
  }
}

// ── send_til_kontoret ─────────────────────────────────────────────────────────
// Samme vej som når kunden skriver under Beskeder (api/portal/messages), så kontoret
// ser den samme sted — markeret som sendt via robotten.

async function sendTilKontoret(besked: string, ctx: RobotKontekst) {
  const tekst = besked.trim().slice(0, 2000)
  if (!tekst) return { fejl: 'Tom besked.' }
  if (ctx.kunde.somAdmin) return { sendt: false, besked: 'Admin kigger med som kunden — beskeden er IKKE sendt (test).' }
  const body = `[Sendt via portal-robotten] ${tekst}`
  const id = randomUUID()
  const udloeb = new Date(); udloeb.setDate(udloeb.getDate() + 30)
  await prisma.$executeRaw`
    INSERT INTO "Message" (id, "customerId", sender, "senderName", body, "readByAdmin", "readByCustomer", "createdAt", "expiresAt")
    VALUES (${id}, ${ctx.kunde.customerId}, 'customer', ${ctx.kunde.navn}, ${body}, false, true, NOW(), ${udloeb})
  `
  const nu = new Date()
  const tz = 'Europe/Copenhagen'
  pushBeskedTilBC(ctx.kunde.customerNo, {
    id, sender: 'customer', senderName: ctx.kunde.navn, body,
    createdAtDK: nu.toLocaleTimeString('da-DK', { timeZone: tz, hour: '2-digit', minute: '2-digit' }) + ' ' +
                 nu.toLocaleDateString('da-DK', { timeZone: tz, day: '2-digit', month: '2-digit' }),
  }).catch(err => console.error('[robot] besked til BC fejlede', err))
  flagBeskedUlaest(ctx.kunde.customerNo).catch(() => {})
  return { sendt: true, besked: 'Sendt til kontoret. Kunden kan følge svaret under Beskeder.' }
}
