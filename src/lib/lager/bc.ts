// Lager-appen → BC. Kun stregkoder i denne fil.
//
// Fortolkningen af en stregkode ligger ÉT sted: codeunit 50307 i BC, som pakkeriet også
// bruger. Portalen gætter ikke selv på formater — den sender koden ind og får svaret.
// API-siderne er scanLookups (side 50600) og barcodeLearns (side 50601).

import { bcBaseUrl, bcPortalBaseUrl, getAccessToken } from '@/lib/businesscentral'

export interface ScanResult {
  found: boolean
  itemNo: string
  itemId: string
  description: string
  description2: string
  /** Antal stregkoden selv siger: vægten på en kasse, gram i en EAN-vægtkode, ellers 1. */
  quantity: number
  lotNo: string
  unitOfMeasureCode: string
  /** true = koden bærer en FAKTISK vægt. Må aldrig ganges op eller lægges sammen som stk. */
  variableWeight: boolean
  /** 'kasse' | 'vmvaegt' | 'eanvaegt' | 'lot' | 'reference' | 'modtagelse' | 'varenr' | 'ukendt' */
  codeType: string
  baseUnitOfMeasure: string
  salesUnitOfMeasure: string
  qtyPerUnitOfMeasure: number
  qtyPerSalesUnit: number
  inventory: number
  itemCategoryCode: string
  blocked: boolean
  gtin: string
  netWeight: number
  errorText: string
}

export interface LearnResult {
  created: boolean
  itemNo: string
  description: string
  qtyPerUnitOfMeasure: number
  existingItemNo: string
  existingDescription: string
  errorText: string
}

async function postPortal(entitySet: string, body: unknown, tag: string): Promise<any | null> {
  const token = await getAccessToken()
  const res = await fetch(`${bcPortalBaseUrl()}/${entitySet}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(body),
    cache: 'no-store',
  } as any)

  if (!res.ok) {
    // Aldrig en tavs fejl: en forkert APIGroup eller en manglende rettighed er et 404/403
    // der ellers forsvinder — og så leder man efter kodefejl i stedet.
    const text = await res.text().catch(() => '')
    console.error(`[lager ${tag}] POST ${entitySet} fejlede ${res.status}: ${text}`)
    return null
  }
  return res.json()
}

/**
 * Slår én scannet stregkode op i BC. Returnerer null hvis BC ikke kunne svare —
 * det er en TEKNISK fejl. En kode BC ikke kender giver et svar med found = false,
 * så appen kan tilbyde "lær koden".
 */
export async function resolveBarcode(
  barcode: string,
  locationCode = '',
  context = '',
): Promise<ScanResult | null> {
  const row = await postPortal(
    'scanLookups',
    { barcode, locationCode, context },
    'scan',
  )
  if (!row) return null
  return {
    found: !!row.found,
    itemNo: row.itemNo ?? '',
    itemId: row.itemId ?? '',
    description: row.description ?? '',
    description2: row.description2 ?? '',
    quantity: Number(row.quantity ?? 0),
    lotNo: row.lotNo ?? '',
    unitOfMeasureCode: row.unitOfMeasureCode ?? '',
    variableWeight: !!row.variableWeight,
    codeType: row.codeType ?? '',
    baseUnitOfMeasure: row.baseUnitOfMeasure ?? '',
    salesUnitOfMeasure: row.salesUnitOfMeasure ?? '',
    qtyPerUnitOfMeasure: Number(row.qtyPerUnitOfMeasure ?? 1),
    qtyPerSalesUnit: Number(row.qtyPerSalesUnit ?? 0),
    inventory: Number(row.inventory ?? 0),
    itemCategoryCode: row.itemCategoryCode ?? '',
    blocked: !!row.blocked,
    gtin: row.gtin ?? '',
    netWeight: Number(row.netWeight ?? 0),
    errorText: row.errorText ?? '',
  }
}

export interface CountHoved {
  no: string
  locationCode: string
  countedBy: string
  note: string
}

export interface CountLinje {
  itemNo: string
  total: number
  uom: string
  estimated: boolean
  antal: number
  shelves: string
  lotNo: string
  remark: string
}

/**
 * Sender en færdig optælling til BC: hovedet, én linje pr. vare, og til sidst besked
 * om at skrive lageropgørelseskladden (writeJournal).
 *
 * Rækkefølgen er vigtig: hovedet SKAL ligge før linjerne, og writeJournal til sidst —
 * ellers skriver BC en kladde af en halv tælling. Fejler en linje, stopper vi og lader
 * hovedet stå som Modtaget, så den kan sendes igen uden at der er skrevet en kladde.
 */
export async function sendCountToBC(
  hoved: CountHoved,
  linjer: CountLinje[],
): Promise<{ ok: boolean; linjer?: number; afvigelser?: number; fejl?: string }> {
  const token = await getAccessToken()
  const base = bcPortalBaseUrl()
  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  }

  // 1) Hovedet. Findes det allerede (gensendelse), er det fint — vi fortsætter.
  const hRes = await fetch(`${base}/lagerCounts`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      no: hoved.no,
      locationCode: hoved.locationCode,
      countedBy: hoved.countedBy.slice(0, 100),
      note: (hoved.note ?? '').slice(0, 250),
    }),
    cache: 'no-store',
  } as any)
  if (!hRes.ok && hRes.status !== 409) {
    const body = await hRes.text().catch(() => '')
    console.error(`[lager optaelling] hoved ${hoved.no} fejlede ${hRes.status}: ${body}`)
    return { ok: false, fejl: `BC afviste optællingen (${hRes.status})` }
  }

  // 2) Linjerne. Linjenummeret er vores eget og stabilt, så en gensendelse rammer
  //    samme række i stedet for at lave en ny.
  let lineNo = 10000
  for (const l of linjer) {
    const res = await fetch(`${base}/lagerCountLines`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        countNo: hoved.no,
        lineNo,
        itemNo: l.itemNo,
        quantity: l.total,
        unitOfMeasureCode: l.uom,
        estimated: l.estimated,
        shelves: (l.shelves ?? '').slice(0, 250),
        countedBy: hoved.countedBy.slice(0, 100),
        scanCount: l.antal,
        lotNo: (l.lotNo ?? '').slice(0, 50),
        // Bemærkningen havner i sit eget felt på kladdelinjen sammen med ANSLÅET-mærket.
        remark: (l.remark ?? '').slice(0, 150),
      }),
      cache: 'no-store',
    } as any)
    if (!res.ok && res.status !== 409) {
      const body = await res.text().catch(() => '')
      console.error(`[lager optaelling] linje ${l.itemNo} fejlede ${res.status}: ${body}`)
      return { ok: false, fejl: `BC afviste linjen ${l.itemNo} (${res.status})` }
    }
    lineNo += 10000
  }

  // 3) Skriv kladden. Det er her BC henter sin egen beholdning og regner afvigelsen ud.
  const pRes = await fetch(`${base}/lagerCounts('${encodeURIComponent(hoved.no)}')`, {
    method: 'PATCH',
    headers: { ...headers, 'If-Match': '*' },
    body: JSON.stringify({ writeJournal: true }),
    cache: 'no-store',
  } as any)
  if (!pRes.ok) {
    const body = await pRes.text().catch(() => '')
    console.error(`[lager optaelling] writeJournal ${hoved.no} fejlede ${pRes.status}: ${body}`)
    // BC's egen fejltekst er den brugbare her — fx at kladden ikke var tom.
    return { ok: false, fejl: bcFejltekst(body) || `Kladden kunne ikke skrives (${pRes.status})` }
  }

  const data = await pRes.json().catch(() => ({}))
  return {
    ok: true,
    linjer: Number(data.linesWritten ?? linjer.length),
    afvigelser: Number(data.diffLines ?? 0),
  }
}

/** Plukker den læsbare besked ud af BC's fejlsvar, så lageret ser årsagen og ikke et tal. */
function bcFejltekst(body: string): string {
  try {
    const j = JSON.parse(body)
    return String(j?.error?.message ?? '').split('CorrelationId')[0].trim()
  } catch {
    return ''
  }
}

export interface Lokation {
  kode: string
  navn: string
}

/**
 * Lokationerne fra BC. BC har ~50, men de færreste er vores eget lager: resten er
 * auktioner, lønhuggere og fryse-/fordelingshuse. Hvilke der tælles på, afgøres af
 * hvilke der har hylder i appen — IKKE af en liste hårdkodet her, for de koder
 * ændrer sig uden at nogen fortæller det.
 */
export async function hentLokationer(): Promise<Lokation[]> {
  const token = await getAccessToken()
  const res = await fetch(`${bcBaseUrl()}/locations?$select=code,displayName&$orderby=code`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    cache: 'no-store',
  } as any)
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    console.error(`[lager lokationer] GET fejlede ${res.status}: ${body}`)
    return []
  }
  const data = await res.json()
  return (data.value ?? []).map((l: any) => ({ kode: l.code ?? '', navn: l.displayName ?? '' }))
}

/**
 * Knytter en ukendt stregkode til en vare. Koden bliver en ÆGTE varereference i BC,
 * så den virker overalt bagefter — også i pakkeriet og på salg.
 * created = false med en errorText betyder at koden var optaget; intet blev ændret.
 */
export async function learnBarcode(
  barcode: string,
  itemNo: string,
  unitOfMeasureCode = '',
  context = '',
): Promise<LearnResult | null> {
  const row = await postPortal(
    'barcodeLearns',
    { barcode, itemNo, unitOfMeasureCode, context },
    'laer',
  )
  if (!row) return null
  return {
    created: !!row.created,
    itemNo: row.itemNo ?? '',
    description: row.description ?? '',
    qtyPerUnitOfMeasure: Number(row.qtyPerUnitOfMeasure ?? 0),
    existingItemNo: row.existingItemNo ?? '',
    existingDescription: row.existingDescription ?? '',
    errorText: row.errorText ?? '',
  }
}
