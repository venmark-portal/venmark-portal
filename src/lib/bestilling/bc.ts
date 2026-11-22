// Bestillingsappen → BC.
//
// Stregkode-opslaget er det SAMME som lager-appens (side 50600, cu 50307). Her beder vi
// bare om indkøbsdelen af svaret med: leverandør, ordrekvantum, hylde og de tre sidste
// køb. Fortolkningen af koden gætter portalen stadig ikke selv på.
//
// Der er INGEN priser i dette lag — hverken kostpris eller sidste indkøbspris. BC
// henter prisen når købsordren oprettes, og en pris på en håndterminal er en pris alle
// ved rampen kan læse (Claus 22-11).

import { bcBaseUrl, bcPortalBaseUrl, getAccessToken } from '@/lib/businesscentral'

export interface SidsteKoeb {
  dato: string
  antal: number
  leverandoer: string
}

export interface BestillingOpslag {
  found: boolean
  itemNo: string
  description: string
  baseUnitOfMeasure: string
  unitOfMeasureCode: string
  quantity: number
  variableWeight: boolean
  codeType: string
  blocked: boolean
  inventory: number
  vendorNo: string
  vendorName: string
  vendorItemNo: string
  /** Ordrekvantum (varekortets felt 36) — det antal appen foreslår. 0 = intet forslag. */
  reorderQuantity: number
  unitsPerParcel: number
  shelfNo: string
  reorderPoint: number
  minimumOrderQuantity: number
  leadTime: string
  /** De tre sidste køb, nyeste først. Kun de poster der findes. */
  sidsteKoeb: SidsteKoeb[]
  errorText: string
}

function dato(v: unknown): string {
  const s = String(v ?? '')
  // BC sender 0001-01-01 for en tom dato.
  return !s || s.startsWith('0001') ? '' : s.slice(0, 10)
}

/**
 * Slår én scannet eller tastet kode op, med indkøbsdata. Returnerer null hvis BC slet
 * ikke kunne svare — det er en TEKNISK fejl. En kode BC ikke kender giver et svar med
 * found = false, så appen kan sige "den kender vi ikke" i stedet for at vise en fejl.
 */
export async function opslagTilBestilling(
  barcode: string,
  locationCode = '',
): Promise<BestillingOpslag | null> {
  const token = await getAccessToken()
  const res = await fetch(`${bcPortalBaseUrl()}/scanLookups`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ barcode, locationCode, context: 'bestilling', withPurchInfo: true }),
    cache: 'no-store',
  } as any)

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    console.error(`[bestilling opslag] POST scanLookups fejlede ${res.status}: ${text}`)
    return null
  }

  const row = await res.json()
  const koeb: SidsteKoeb[] = []
  for (const i of [1, 2, 3]) {
    const d = dato(row[`lastPurchDate${i}`])
    if (!d) continue
    koeb.push({
      dato: d,
      antal: Number(row[`lastPurchQty${i}`] ?? 0),
      leverandoer: row[`lastPurchVendor${i}`] ?? '',
    })
  }

  return {
    found: !!row.found,
    itemNo: row.itemNo ?? '',
    description: row.description ?? '',
    baseUnitOfMeasure: row.baseUnitOfMeasure ?? '',
    unitOfMeasureCode: row.unitOfMeasureCode ?? '',
    quantity: Number(row.quantity ?? 0),
    variableWeight: !!row.variableWeight,
    codeType: row.codeType ?? '',
    blocked: !!row.blocked,
    inventory: Number(row.inventory ?? 0),
    vendorNo: row.vendorNo ?? '',
    vendorName: row.vendorName ?? '',
    vendorItemNo: row.vendorItemNo ?? '',
    reorderQuantity: Number(row.reorderQuantity ?? 0),
    unitsPerParcel: Number(row.unitsPerParcel ?? 0),
    shelfNo: row.shelfNo ?? '',
    reorderPoint: Number(row.reorderPoint ?? 0),
    minimumOrderQuantity: Number(row.minimumOrderQuantity ?? 0),
    leadTime: row.leadTime ?? '',
    sidsteKoeb: koeb,
    errorText: row.errorText ?? '',
  }
}

export interface BestillingHoved {
  no: string
  locationCode: string
  orderedBy: string
  note: string
}

export interface BestillingBcLinje {
  itemNo: string
  qty: number
  uom: string
  vendorNo: string
  remark: string
  barcode: string
  scanCount: number
  reorderQty: number
}

/**
 * Sender en færdig bestilling til BC: hovedet, én linje pr. vare, og derefter besked om
 * at oprette købsordrerne (createOrders).
 *
 * Rækkefølgen er vigtig: hovedet SKAL ligge før linjerne, og createOrders til sidst —
 * ellers laver BC købsordrer af en halv kurv. Fejler en linje, stopper vi og lader
 * hovedet stå som Modtaget, så kurven kan sendes igen uden at der er oprettet noget.
 */
export async function sendBestillingTilBC(
  hoved: BestillingHoved,
  linjer: BestillingBcLinje[],
): Promise<{ ok: boolean; ordrer?: number; ordreNumre?: string; linjer?: number; fejlede?: number; fejl?: string }> {
  const token = await getAccessToken()
  const base = bcPortalBaseUrl()
  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  }

  // 1) Hovedet. Findes det allerede (gensendelse), er det fint — vi fortsætter.
  const hRes = await fetch(`${base}/purchRequests`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      no: hoved.no,
      locationCode: hoved.locationCode,
      orderedBy: hoved.orderedBy.slice(0, 100),
      note: (hoved.note ?? '').slice(0, 250),
    }),
    cache: 'no-store',
  } as any)
  if (!hRes.ok && hRes.status !== 409) {
    const body = await hRes.text().catch(() => '')
    console.error(`[bestilling] hoved ${hoved.no} fejlede ${hRes.status}: ${body}`)
    return { ok: false, fejl: bcFejltekst(body) || `BC afviste bestillingen (${hRes.status})` }
  }

  // 2) Linjerne. Linjenummeret er vores eget og stabilt, så en gensendelse rammer
  //    samme række i stedet for at lave en ny.
  let lineNo = 10000
  for (const l of linjer) {
    const res = await fetch(`${base}/purchRequestLines`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        requestNo: hoved.no,
        lineNo,
        itemNo: l.itemNo,
        quantity: l.qty,
        unitOfMeasureCode: l.uom,
        vendorNo: l.vendorNo,
        orderedBy: hoved.orderedBy.slice(0, 100),
        remark: (l.remark ?? '').slice(0, 150),
        barcode: (l.barcode ?? '').slice(0, 50),
        scanCount: l.scanCount,
        reorderQuantity: l.reorderQty,
      }),
      cache: 'no-store',
    } as any)
    if (!res.ok && res.status !== 409) {
      const body = await res.text().catch(() => '')
      console.error(`[bestilling] linje ${l.itemNo} fejlede ${res.status}: ${body}`)
      return { ok: false, fejl: bcFejltekst(body) || `BC afviste linjen ${l.itemNo} (${res.status})` }
    }
    lineNo += 10000
  }

  // 3) Opret købsordrerne. Her deler BC op pr. leverandør og henter priserne.
  const pRes = await fetch(`${base}/purchRequests('${encodeURIComponent(hoved.no)}')`, {
    method: 'PATCH',
    headers: { ...headers, 'If-Match': '*' },
    body: JSON.stringify({ createOrders: true }),
    cache: 'no-store',
  } as any)
  if (!pRes.ok) {
    const body = await pRes.text().catch(() => '')
    console.error(`[bestilling] createOrders ${hoved.no} fejlede ${pRes.status}: ${body}`)
    return { ok: false, fejl: bcFejltekst(body) || `Købsordrerne kunne ikke oprettes (${pRes.status})` }
  }

  const data = await pRes.json().catch(() => ({}))
  return {
    ok: true,
    ordrer: Number(data.ordersCreated ?? 0),
    ordreNumre: String(data.orderNos ?? ''),
    linjer: Number(data.linesWritten ?? 0),
    fejlede: Number(data.linesFailed ?? 0),
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

export interface Leverandoer {
  nr: string
  navn: string
}

/**
 * Leverandørsøgning. Bruges KUN når varen ikke har en leverandør på varekortet —
 * ellers ville BC afvise linjen, og lagermanden ville stå med en kurv der ikke kan
 * sendes, uden nogen vej videre.
 */
export async function soegLeverandoerer(q: string, maks = 20): Promise<Leverandoer[]> {
  const token = await getAccessToken()
  const tekst = q.trim().replace(/'/g, "''")
  if (tekst.length < 2) return []
  const filter = `contains(displayName,'${tekst}') or startswith(number,'${tekst}')`
  // $top er med vilje her: vi VIL kun have de første 20 træf til en søgeliste.
  // Det er kun ved komplette katalogtræk at $top er farligt — der slår den
  // nextLink fra og afkorter svaret tavst.
  const url =
    `${bcBaseUrl()}/vendors?$select=number,displayName&$filter=${encodeURIComponent(filter)}` +
    `&$orderby=displayName&$top=${maks}`
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    cache: 'no-store',
  } as any)
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    console.error(`[bestilling leverandoerer] GET fejlede ${res.status}: ${body}`)
    return []
  }
  const data = await res.json()
  return (data.value ?? []).map((v: any) => ({ nr: v.number ?? '', navn: v.displayName ?? '' }))
}
