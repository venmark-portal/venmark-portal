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
