/**
 * Business Central Online API klient
 *
 * Bruger OAuth2 Client Credentials flow (App-to-App)
 * Konfigureres via .env.local — se README.md for opsætning.
 */

export interface BCItem {
  id: string
  number: string
  displayName: string
  baseUnitOfMeasureCode: string
  itemCategoryCode: string
  unitPrice: number
  inventory: number
  picture?: BCPicture
}

export interface BCPicture {
  id: string
  parentType?: string
  contentType: string
  width?: number
  height?: number
  'pictureContent@odata.mediaReadLink'?: string
  'pictureContent@odata.mediaEditLink'?: string
}

export interface BCItemsResponse {
  '@odata.context': string
  value: BCItem[]
  '@odata.nextLink'?: string
}

// ─── Token cache (in-memory, nulstilles ved server-genstart) ─────────────────

let cachedToken: { token: string; expiresAt: number } | null = null

export async function getAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt - 60_000) {
    return cachedToken.token
  }

  const tenantId     = process.env.BC_TENANT_ID!
  const clientId     = process.env.BC_CLIENT_ID!
  const clientSecret = process.env.BC_CLIENT_SECRET!

  if (!tenantId || !clientId || !clientSecret) {
    throw new Error(
      'Business Central credentials mangler i .env.local — se README.md'
    )
  }

  const tokenUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`

  const body = new URLSearchParams({
    grant_type:    'client_credentials',
    client_id:     clientId,
    client_secret: clientSecret,
    scope:         'https://api.businesscentral.dynamics.com/.default',
  })

  const res = await fetch(tokenUrl, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Token-fejl fra Azure AD: ${res.status} ${err}`)
  }

  const data = await res.json()
  cachedToken = {
    token:     data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  }

  return cachedToken.token
}

// ─── BC API base URL ──────────────────────────────────────────────────────────

export function bcBaseUrl(): string {
  const tenantId   = process.env.BC_TENANT_ID!
  const envName    = process.env.BC_ENVIRONMENT_NAME ?? 'production'
  const companyId  = process.env.BC_COMPANY_ID!       // GUID for dit selskab

  if (!tenantId || !companyId) {
    throw new Error('BC_TENANT_ID og BC_COMPANY_ID skal sættes i .env.local')
  }

  return (
    `https://api.businesscentral.dynamics.com/v2.0` +
    `/${tenantId}/${envName}/api/v2.0/companies(${companyId})`
  )
}

// ─── Hent varer ──────────────────────────────────────────────────────────────

export interface GetItemsOptions {
  search?:   string   // fri-tekst søgning på displayName/number
  category?: string   // itemCategoryCode filter
  top?:      number   // antal resultater (default 50)
  skip?:     number   // til paginering
}

export async function getItems(opts: GetItemsOptions = {}): Promise<BCItemsResponse> {
  const token = await getAccessToken()
  const base  = bcBaseUrl()

  const { search, category, top = 50, skip = 0 } = opts

  const selectExpand = {
    $select: 'id,number,displayName,baseUnitOfMeasureCode,itemCategoryCode,unitPrice,inventory',
    $expand: 'picture',
  }

  // BC OData tillader IKKE 'or' på tværs af FORSKELLIGE felter (f.eks. number og displayName).
  // Løsning: to separate kald der merges og dedupliceres efter id.
  if (search) {
    const q           = search.trim()
    const capitalized = q.charAt(0).toUpperCase() + q.slice(1)
    const catPart     = category ? ` and itemCategoryCode eq '${category}'` : ''

    const numFilterStr  = `(startswith(number,'${q}') or number eq '${q}')${catPart}`
    const nameFilterStr = (capitalized !== q
      ? `(contains(displayName,'${capitalized}') or contains(displayName,'${q}'))`
      : `contains(displayName,'${q}')`) + catPart

    const params = new URLSearchParams({ ...selectExpand, $top: String(top) })

    const headers = { Authorization: `Bearer ${token}`, Accept: 'application/json' }
    const cacheOpts = { next: { revalidate: 300 } } as const

    const [resNum, resName] = await Promise.all([
      fetch(`${base}/items?${params}&$filter=${encodeURIComponent(numFilterStr)}`,  { headers, ...cacheOpts }),
      fetch(`${base}/items?${params}&$filter=${encodeURIComponent(nameFilterStr)}`, { headers, ...cacheOpts }),
    ])

    if (!resNum.ok && !resName.ok) {
      const err = await resNum.text()
      throw new Error(`BC API fejl: ${resNum.status} ${err}`)
    }

    const numData  = resNum.ok  ? await resNum.json()  : { value: [] }
    const nameData = resName.ok ? await resName.json() : { value: [] }

    // Merge og dedupliker — varenummer-matches vises først
    const seen   = new Set<string>()
    const merged: BCItem[] = []
    for (const item of [...(numData.value ?? []), ...(nameData.value ?? [])]) {
      if (!seen.has(item.id)) {
        seen.add(item.id)
        merged.push(item)
        if (merged.length >= top) break
      }
    }

    return {
      '@odata.context': numData['@odata.context'] ?? nameData['@odata.context'] ?? '',
      value: merged,
    }
  }

  // Ingen søgning: enkelt kald med evt. kategorifilter
  const filters: string[] = []
  if (category) filters.push(`itemCategoryCode eq '${category}'`)

  const params = new URLSearchParams({ ...selectExpand, $top: String(top), $skip: String(skip) })
  if (filters.length) params.set('$filter', filters.join(' and '))

  const res = await fetch(`${base}/items?${params}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    next: { revalidate: 300 },
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`BC API fejl: ${res.status} ${err}`)
  }

  return res.json()
}

// ─── Hent varegrupper (til filter-menu) ──────────────────────────────────────

export interface BCItemCategory {
  code: string
  displayName: string
}

/**
 * Gør en rå BC-kategori-kode pæn til visning.
 * Eksempler: "FARS-PLUK" → "Fars Pluk", "FARSPROD" → "Farsprod", "FERSKLAKS" → "Fersklaks"
 */
function prettifyCode(code: string): string {
  return code
    .split(/[-_\s]+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ')
}

export async function getItemCategories(): Promise<BCItemCategory[]> {
  const token = await getAccessToken()
  const base  = bcBaseUrl()

  // Hent 1000 varer med kun itemCategoryCode — finder alle kategorier der faktisk bruges
  const itemsRes = await fetch(
    `${base}/items?$select=itemCategoryCode&$top=1000`,
    {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      next: { revalidate: 3600 },
    }
  )

  // Hent kategori-navne til display
  const catRes = await fetch(
    `${base}/itemCategories?$select=code,displayName`,
    {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      next: { revalidate: 3600 },
    }
  )

  if (!itemsRes.ok) return []

  const itemsData = await itemsRes.json()

  // Find alle distinkte kategori-koder der rent faktisk er brugt på varer
  const usedCodes = new Set<string>()
  for (const item of (itemsData.value ?? [])) {
    if (item.itemCategoryCode) usedCodes.add(item.itemCategoryCode)
  }

  // Byg opslag: kode → displayName fra itemCategories
  const nameMap = new Map<string, string>()
  if (catRes.ok) {
    const catData = await catRes.json()
    for (const cat of (catData.value ?? [])) {
      if (cat.code && cat.displayName) nameMap.set(cat.code, cat.displayName)
    }
  }

  // Returner kun kategorier der har varer, med display-navn hvis tilgængeligt
  const result: BCItemCategory[] = Array.from(usedCodes).map((code) => ({
    code,
    displayName: nameMap.get(code) ?? prettifyCode(code), // Gør koden pæn som fallback
  }))

  return result.sort((a, b) =>
    a.displayName.localeCompare(b.displayName, 'da')
  )
}

// ─── Hent kundespecifikke priser (via prisgruppe) ────────────────────────────

export interface BCCustomerPrice {
  itemNumber: string
  unitPrice:  number
  uom:        string
}

/**
 * Henter salgspriser for en given prisgruppe.
 * Hvis kunden ikke har nogen specielle priser, returneres tom liste
 * og vi falder tilbage på varekortets unitPrice.
 */
export async function getCustomerPrices(priceGroup: string): Promise<BCCustomerPrice[]> {
  if (!priceGroup) return []

  const token = await getAccessToken()
  const base  = bcBaseUrl()

  // BC OData filter: salesType = 'Customer Price Group', salesCode = prisgruppe
  const filter = `salesType eq 'Customer Price Group' and salesCode eq '${priceGroup}'`
  const res = await fetch(
    `${base}/salesPrices?$filter=${encodeURIComponent(filter)}&$select=itemNumber,unitPrice,unitOfMeasureCode`,
    {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      next: { revalidate: 600 },
    }
  )

  if (!res.ok) return [] // Endpoint findes måske ikke — ignorer fejl

  const data = await res.json()
  return (data.value ?? []).map((p: any) => ({
    itemNumber: p.itemNumber,
    unitPrice:  p.unitPrice,
    uom:        p.unitOfMeasureCode ?? '',
  }))
}

// ─── Hent priser + favoritter via PortalPriceListAPI ─────────────────────────

export interface BCPortalPrice {
  id:              string
  priceListCode:   string
  sourceType:      string   // 'Customer' | 'Customer Price Group' | 'All Customers'
  sourceNo:        string   // debitornr. eller prisgruppekode
  itemNo:          string
  unitOfMeasure:   string
  minimumQuantity: number
  unitPrice:       number
  startingDate:    string | null
  endingDate:      string | null
  portalFavorite:  boolean
}

/**
 * Henter alle aktive prislinjer (inkl. trappepriser + portal-favoritmarkering)
 * for en given kunde og/eller prisgruppe via Sales-warehouse-facade extensionen.
 * Returnerer [] hvis extensionen ikke er deployed.
 */
export async function getPortalPrices(
  customerNo: string,
  priceGroup?: string,
): Promise<BCPortalPrice[]> {
  if (!customerNo && !priceGroup) return []
  try {
    const token   = await getAccessToken()
    const tenant  = process.env.BC_TENANT_ID
    const env     = process.env.BC_ENVIRONMENT_NAME
    const company = process.env.BC_COMPANY_ID
    const base    = `https://api.businesscentral.dynamics.com/v2.0/${tenant}/${env}/api/venmark/portal/v1.0/companies(${company})`

    const headers  = { Authorization: `Bearer ${token}`, Accept: 'application/json' }
    const cacheOpts = { next: { revalidate: 300 } } as const

    // BC OData understøtter ikke OR på tværs af felter — brug parallelle kald
    const fetches: Promise<Response>[] = []

    if (customerNo) {
      const f = encodeURIComponent(`sourceType eq 'Customer' and sourceNo eq '${customerNo}'`)
      fetches.push(fetch(`${base}/portalPrices?$filter=${f}&$top=2000`, { headers, ...cacheOpts }))
    }
    if (priceGroup) {
      // BC serialiserer enum-værdien som "Customer_x0020_Price_x0020_Group" i JSON-svar,
      // men OData-filter bruger den rå enum-tekst. Prøv begge varianter parallelt.
      const f1 = encodeURIComponent(`sourceType eq 'Customer Price Group' and sourceNo eq '${priceGroup}'`)
      const f2 = encodeURIComponent(`sourceType eq 'Customer_x0020_Price_x0020_Group' and sourceNo eq '${priceGroup}'`)
      fetches.push(fetch(`${base}/portalPrices?$filter=${f1}&$top=2000`, { headers, ...cacheOpts }))
      fetches.push(fetch(`${base}/portalPrices?$filter=${f2}&$top=2000`, { headers, ...cacheOpts }))
    }
    // All Customers priser — prøv begge varianter
    const fAll1 = encodeURIComponent(`sourceType eq 'All Customers'`)
    const fAll2 = encodeURIComponent(`sourceType eq 'All_x0020_Customers'`)
    fetches.push(fetch(`${base}/portalPrices?$filter=${fAll1}&$top=2000`, { headers, ...cacheOpts }))
    fetches.push(fetch(`${base}/portalPrices?$filter=${fAll2}&$top=2000`, { headers, ...cacheOpts }))

    const responses = await Promise.all(fetches)
    const allItems: any[] = []
    for (const res of responses) {
      if (res.ok) {
        const data = await res.json()
        allItems.push(...(data.value ?? []))
      }
    }

    // Dedupliker på id
    const seen = new Set<string>()
    return allItems
      .filter(p => { if (seen.has(p.id)) return false; seen.add(p.id); return true })
      .map((p: any) => ({
        id:              p.id,
        priceListCode:   p.priceListCode ?? '',
        sourceType:      p.sourceType ?? '',
        sourceNo:        p.sourceNo ?? '',
        itemNo:          p.itemNo,
        unitOfMeasure:   p.unitOfMeasure ?? '',
        minimumQuantity: p.minimumQuantity ?? 0,
        unitPrice:       p.unitPrice,
        // BC bruger "0001-01-01" som "ingen dato sat" — normaliser til null
        startingDate:    (!p.startingDate || p.startingDate === '0001-01-01') ? null : p.startingDate,
        endingDate:      (!p.endingDate   || p.endingDate   === '0001-01-01') ? null : p.endingDate,
        portalFavorite:  p.portalFavorite ?? false,
      }))
  } catch { return [] }
}

// ─── Hent trappepriser via Sales-warehouse-facade API ────────────────────────

export interface BCPriceTier {
  itemNo:          string
  minimumQuantity: number
  unitPrice:       number
  unitOfMeasure:   string
  startingDate:    string | null
  endingDate:      string | null
}

/**
 * Henter alle prisrader inkl. trappepriser (minimumQuantity) for en prisgruppe.
 * Kræver PortalPricesAPI i Sales-warehouse-facade extensionen.
 * Returnerer [] hvis extensionen ikke er deployed.
 *
 * Trappelogik: vælg den post med højeste minimumQuantity der er <= ønsket antal.
 */
export async function getCustomerPriceTiers(priceGroup: string): Promise<BCPriceTier[]> {
  if (!priceGroup) return []
  try {
    const token  = await getAccessToken()
    const tenant = process.env.BC_TENANT_ID
    const env    = process.env.BC_ENVIRONMENT_NAME
    const company = process.env.BC_COMPANY_ID
    const base   = `https://api.businesscentral.dynamics.com/v2.0/${tenant}/${env}/api/venmark/portal/v1.0/companies(${company})`
    const filter = encodeURIComponent(`salesCode eq '${priceGroup}' and salesType eq 'Customer Price Group'`)

    const res = await fetch(`${base}/customerPrices?$filter=${filter}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      next: { revalidate: 600 },
    })
    if (!res.ok) return []

    const data = await res.json()
    return (data.value ?? []).map((p: any) => ({
      itemNo:          p.itemNo,
      minimumQuantity: p.minimumQuantity ?? 0,
      unitPrice:       p.unitPrice,
      unitOfMeasure:   p.unitOfMeasure ?? '',
      startingDate:    p.startingDate ?? null,
      endingDate:      p.endingDate   ?? null,
    }))
  } catch { return [] }
}

/**
 * Finder den rigtige pris for en given vare og mængde ud fra trappepriser.
 * Falder tilbage på varens basispris hvis ingen trappepriser findes.
 */
export function resolvePrice(
  itemNo: string,
  quantity: number,
  tiers: BCPriceTier[],
  fallbackPrice: number,
): number {
  const today = new Date().toISOString().split('T')[0]
  const applicable = tiers
    .filter(t =>
      t.itemNo === itemNo &&
      t.minimumQuantity <= quantity &&
      (!t.startingDate || t.startingDate <= today) &&
      (!t.endingDate   || t.endingDate   >= today)
    )
    .sort((a, b) => b.minimumQuantity - a.minimumQuantity) // Højeste min.antal først

  return applicable[0]?.unitPrice ?? fallbackPrice
}

// ─── Hent favoritvarer via Sales-warehouse-facade API ────────────────────────

export interface BCCustomerFavorite {
  salesCode:     string
  lineNo:        number
  itemNo:        string
  description:   string
  quantity:      number
  unitOfMeasure: string
}

/**
 * Henter kundens favoritvarer fra Standard Sales Lines i BC.
 * Kræver PortalFavoritesAPI i Sales-warehouse-facade extensionen.
 * Returnerer [] hvis extensionen ikke er deployed.
 */
export async function getCustomerFavorites(salesCode: string): Promise<BCCustomerFavorite[]> {
  if (!salesCode) return []
  try {
    const token  = await getAccessToken()
    const tenant = process.env.BC_TENANT_ID
    const env    = process.env.BC_ENVIRONMENT_NAME
    const company = process.env.BC_COMPANY_ID
    const base   = `https://api.businesscentral.dynamics.com/v2.0/${tenant}/${env}/api/venmark/portal/v1.0/companies(${company})`
    const filter = encodeURIComponent(`salesCode eq '${salesCode}'`)

    const res = await fetch(`${base}/customerFavorites?$filter=${filter}&$orderby=lineNo`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      next: { revalidate: 120 },
    })
    if (!res.ok) return []

    const data = await res.json()
    return (data.value ?? []).map((f: any) => ({
      salesCode:     f.salesCode,
      lineNo:        f.lineNo,
      itemNo:        f.itemNo,
      description:   f.description,
      quantity:      f.quantity ?? 1,
      unitOfMeasure: f.unitOfMeasure ?? '',
    }))
  } catch { return [] }
}

// ─── Toggle portalFavorite på BC prislistelinje ───────────────────────────────

/**
 * Sætter portalFavorite = isFavorite på en BC prislistelinje.
 * Kræver PATCH-support i Sales-warehouse-facade extensionen.
 * Returnerer true hvis BC-opdatering lykkedes.
 */
export async function toggleBCPortalFavorite(
  priceLineId: string,
  isFavorite: boolean,
): Promise<boolean> {
  try {
    const token   = await getAccessToken()
    const tenant  = process.env.BC_TENANT_ID
    const env     = process.env.BC_ENVIRONMENT_NAME
    const company = process.env.BC_COMPANY_ID
    const base    = `https://api.businesscentral.dynamics.com/v2.0/${tenant}/${env}/api/venmark/portal/v1.0/companies(${company})`

    const res = await fetch(`${base}/portalPrices(${priceLineId})`, {
      method: 'PATCH',
      headers: {
        Authorization:  `Bearer ${token}`,
        'Content-Type': 'application/json',
        'If-Match':     '*',
        Accept:         'application/json',
      },
      body: JSON.stringify({ portalFavorite: isFavorite }),
    })
    return res.ok
  } catch {
    return false
  }
}

// ─── Hent bogførte salgsfakturaer ─────────────────────────────────────────────

export interface BCPostedInvoice {
  id:                       string
  number:                   string
  postingDate:              string
  documentDate:             string
  customerNumber:           string
  customerName:             string
  totalAmountExcludingTax:  number
  totalAmountIncludingTax:  number
  remainingAmount:          number
  closed:                   boolean
  dueDate:                  string | null
  paymentTermsCode:         string
}

/**
 * Henter bogførte salgsfakturaer for en kunde fra en given dato.
 * Bruger custom AL extension endpoint (page 50170).
 * fromDate format: 'YYYY-MM-DD'
 */
export async function getPostedInvoices(
  customerNo: string,
  fromDate: string,
): Promise<BCPostedInvoice[]> {
  if (!customerNo) return []
  try {
    const token   = await getAccessToken()
    const tenant  = process.env.BC_TENANT_ID
    const env     = process.env.BC_ENVIRONMENT_NAME
    const company = process.env.BC_COMPANY_ID
    const base    = `https://api.businesscentral.dynamics.com/v2.0/${tenant}/${env}/api/venmark/portal/v1.0/companies(${company})`

    const filter = encodeURIComponent(
      `customerNumber eq '${customerNo}' and postingDate ge ${fromDate}`,
    )

    const res = await fetch(
      `${base}/postedSalesInvoices?$filter=${filter}&$orderby=postingDate desc&$top=200`,
      {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        next: { revalidate: 300 },
      },
    )
    if (!res.ok) return []
    const data = await res.json()
    return (data.value ?? []).map((inv: any) => ({
      id:                      inv.id,
      number:                  inv.number,
      postingDate:             inv.postingDate,
      documentDate:            inv.documentDate ?? inv.postingDate,
      customerNumber:          inv.customerNumber,
      customerName:            inv.customerName ?? '',
      totalAmountExcludingTax: inv.totalAmountExcludingTax ?? 0,
      totalAmountIncludingTax: inv.totalAmountIncludingTax ?? 0,
      remainingAmount:         inv.remainingAmount ?? 0,
      closed:                  inv.closed ?? false,
      dueDate:                 inv.dueDate ?? null,
      paymentTermsCode:        inv.paymentTermsCode ?? '',
    }))
  } catch {
    return []
  }
}

export interface BCInvoiceLine {
  id:                 string
  documentNumber:     string
  lineNumber:         number
  type:               string
  itemNumber:         string
  description:        string
  unitOfMeasureCode:  string
  quantity:           number
  unitPrice:          number
  lineAmount:         number
  amountIncludingVAT: number
}

/**
 * Henter linjer for én bogført salgsfaktura via custom AL extension (page 50171).
 * invoiceNo: fakturaens nummer (f.eks. "102345"), ikke GUID.
 */
export async function getPostedInvoiceLines(invoiceNo: string): Promise<BCInvoiceLine[]> {
  if (!invoiceNo) return []
  try {
    const token   = await getAccessToken()
    const tenant  = process.env.BC_TENANT_ID
    const env     = process.env.BC_ENVIRONMENT_NAME
    const company = process.env.BC_COMPANY_ID
    const base    = `https://api.businesscentral.dynamics.com/v2.0/${tenant}/${env}/api/venmark/portal/v1.0/companies(${company})`

    const filter = encodeURIComponent(`documentNumber eq '${invoiceNo}'`)

    const res = await fetch(
      `${base}/postedSalesInvoiceLines?$filter=${filter}&$orderby=lineNumber`,
      {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        next: { revalidate: 300 },
      },
    )
    if (!res.ok) return []
    const data = await res.json()
    return (data.value ?? []).map((l: any) => ({
      id:                 l.id,
      documentNumber:     l.documentNumber,
      lineNumber:         l.lineNumber ?? 0,
      type:               l.type ?? '',
      itemNumber:         l.itemNumber ?? '',
      description:        l.description ?? '',
      unitOfMeasureCode:  l.unitOfMeasureCode ?? '',
      quantity:           l.quantity ?? 0,
      unitPrice:          l.unitPrice ?? 0,
      lineAmount:         l.lineAmount ?? 0,
      amountIncludingVAT: l.amountIncludingVAT ?? 0,
    }))
  } catch {
    return []
  }
}

// ─── Hent specifikke varer via varenumre ─────────────────────────────────────

/**
 * Henter en liste af specifikke varer fra BC ud fra varenumre.
 * Bruges til at loade favoritvarer og dagens anbefalinger.
 */
export async function getItemsByNumbers(numbers: string[]): Promise<BCItem[]> {
  if (numbers.length === 0) return []

  const token = await getAccessToken()
  const base  = bcBaseUrl()

  // BC understøtter ikke "in" operator — vi henter batch med startswith + OR (max 15 ad gangen)
  // Enkleste approach: hent de første 1000 og filtrer klient-side
  const filter = numbers
    .slice(0, 20)
    .map((n) => `number eq '${n}'`)
    .join(' or ')

  const res = await fetch(
    `${base}/items?$filter=${encodeURIComponent(filter)}&$select=id,number,displayName,baseUnitOfMeasureCode,itemCategoryCode,unitPrice,inventory&$expand=picture`,
    {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      next: { revalidate: 300 },
    }
  )

  if (!res.ok) return []
  const data = await res.json()
  return data.value ?? []
}

// ─── Opret salgsordre i BC ───────────────────────────────────────────────────

export interface BCCreateOrderResult {
  id:         string    // BC ordre GUID
  number:     string    // BC ordrenummer (f.eks. "SO-1234")
  lineErrors?: string[] // linjefejl (ordre er oprettet men nogle linjer fejlede)
}

/**
 * Opretter en salgsordre i BC med tilhørende ordrelinjer.
 * Bruger standard v2.0 API: POST /salesOrders + POST /salesOrderLines.
 * Kaster en fejl hvis ordrehovedet ikke kan oprettes.
 * Enkelt-linje-fejl logges men blokerer ikke oprettelsen.
 */
export async function createBCSalesOrder(
  customerNumber: string,
  deliveryDate:   Date,
  portalOrderId:  string,
  lines: Array<{ itemNumber: string; quantity: number; uomCode: string }>,
): Promise<BCCreateOrderResult> {
  const token = await getAccessToken()
  const base  = bcBaseUrl()

  // 1. Opret ordrehoved
  const orderRes = await fetch(`${base}/salesOrders`, {
    method:  'POST',
    headers: {
      Authorization:  `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept:         'application/json',
    },
    body: JSON.stringify({
      customerNumber,
      requestedDeliveryDate:  deliveryDate.toISOString().split('T')[0],
      externalDocumentNumber: `PORTAL-${portalOrderId}`,
    }),
  })

  if (!orderRes.ok) {
    const errText = await orderRes.text()
    throw new Error(`BC ordrehoved fejlede (${orderRes.status}): ${errText}`)
  }

  const order    = await orderRes.json()
  const orderId  = order.id as string

  // 2. Opret linjer — fejl samles og returneres
  const lineErrors: string[] = []
  for (const line of lines) {
    const lineRes = await fetch(`${base}/salesOrderLines`, {
      method:  'POST',
      headers: {
        Authorization:  `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept:         'application/json',
      },
      body: JSON.stringify({
        documentId:          orderId,
        lineType:            'Item',
        lineObjectNumber:    line.itemNumber,
        quantity:            line.quantity,
        unitOfMeasureCode:   line.uomCode || undefined,
        shipQuantity:        0,   // Spærret til pakning — frigives af salgskontoret i BC
      }),
    })

    if (!lineRes.ok) {
      const errText = await lineRes.text()
      console.error(`BC linje-fejl for vare ${line.itemNumber} (${lineRes.status}):`, errText)
      lineErrors.push(`Vare ${line.itemNumber}: (${lineRes.status}) ${errText}`)
    }
  }

  return {
    id:     orderId,
    number: order.number ?? orderId,
    ...(lineErrors.length > 0 && { lineErrors }),
  }
}

// ─── Gensend linjer til eksisterende BC-ordre ────────────────────────────────

/**
 * Tilføjer ordrelinjer til en allerede oprettet BC-salgsordre.
 * Bruges til at retry fejlede linjer på eksisterende ordrer.
 */
export async function addLinesToBCOrder(
  bcOrderId: string,
  lines: Array<{ itemNumber: string; quantity: number; uomCode: string }>,
): Promise<{ success: number; errors: string[] }> {
  const token  = await getAccessToken()
  const base   = bcBaseUrl()
  let success  = 0
  const errors: string[] = []

  for (const line of lines) {
    const lineRes = await fetch(`${base}/salesOrderLines`, {
      method:  'POST',
      headers: {
        Authorization:  `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept:         'application/json',
      },
      body: JSON.stringify({
        documentId:        bcOrderId,
        lineType:          'Item',
        lineObjectNumber:  line.itemNumber,
        quantity:          line.quantity,
        unitOfMeasureCode: line.uomCode || undefined,
      }),
    })

    if (lineRes.ok) {
      success++
    } else {
      const errText = await lineRes.text()
      console.error(`BC linje-fejl for vare ${line.itemNumber} (${lineRes.status}):`, errText)
      errors.push(`Vare ${line.itemNumber}: (${lineRes.status}) ${errText}`)
    }
  }

  return { success, errors }
}

// ─── Hent linjestatus fra Sales-warehouse-facade API ─────────────────────────

export interface BCPortalLine {
  id:                 string
  documentNo:         string
  lineNo:             number
  lineObjectNumber:   string
  description:        string
  quantity:           number
  unitOfMeasureCode:  string
  unitPrice:          number
  portalLineStatus:   'Afventer' | 'Godkendt' | 'Afvist'
  portalCustomerNote: string
}

/**
 * Henter portallinjer for en given salgsordre via Sales-warehouse-facade API.
 * Kræver at BC-extensionen "Sales-warehouse-facade" er deployed.
 * Returnerer null hvis extensionen ikke er tilgængelig endnu.
 */
export async function getPortalLineStatuses(
  bcOrderNumber: string,
): Promise<BCPortalLine[] | null> {
  try {
    const token = await getAccessToken()
    const env   = process.env.BC_ENVIRONMENT_NAME
    const tenant = process.env.BC_TENANT_ID
    const company = process.env.BC_COMPANY_ID

    const base = `https://api.businesscentral.dynamics.com/v2.0/${tenant}/${env}/api/venmark/portal/v1.0/companies(${company})`
    const filter = encodeURIComponent(`documentNo eq '${bcOrderNumber}'`)

    const res = await fetch(`${base}/portalSalesLines?$filter=${filter}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept:        'application/json',
      },
      next: { revalidate: 30 },   // cache 30 sekunder
    })

    if (!res.ok) return null   // Extension ikke deployed endnu

    const data = await res.json()
    return data.value as BCPortalLine[]
  } catch {
    return null
  }
}

// ─── Hent vareattributter fra BC ─────────────────────────────────────────────

export interface BCItemAttributeValue {
  attributeName: string
  value:         string
}

/**
 * Henter alle attributter for en liste af varer parallelt.
 * Returnerer en Map: itemNumber → attributter.
 * Caches i 1 time. Returnerer tom Map ved fejl.
 */
export async function getItemsAttributeValues(
  items: Array<{ id: string; number: string }>,
): Promise<Map<string, BCItemAttributeValue[]>> {
  if (items.length === 0) return new Map()
  try {
    const token = await getAccessToken()
    const base  = bcBaseUrl()

    const results = await Promise.allSettled(
      items.map(async ({ id, number }) => {
        const res = await fetch(`${base}/items(${id})/itemAttributeValues`, {
          headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
          next: { revalidate: 3600 },
        })
        if (!res.ok) return { number, attrs: [] as BCItemAttributeValue[] }
        const data = await res.json()
        return {
          number,
          attrs: (data.value ?? []).map((a: any) => ({
            attributeName: a.attributeName ?? '',
            value:         a.value ?? '',
          })) as BCItemAttributeValue[],
        }
      }),
    )

    const map = new Map<string, BCItemAttributeValue[]>()
    for (const r of results) {
      if (r.status === 'fulfilled') map.set(r.value.number, r.value.attrs)
    }
    return map
  } catch {
    return new Map()
  }
}

// ─── Hent vareenheders oversigt (itemUnitsOfMeasure) ─────────────────────────

export interface BCItemUoM {
  code:                string
  displayName:         string
  qtyPerUnitOfMeasure: number
  baseUnitOfMeasure:   boolean
}

/**
 * Henter alle enheder (UoM) for en liste varer parallelt.
 * Returnerer Map: itemNumber → UoM-liste sorteret med base-enhed først.
 * Caches 1 time.
 */
export async function getItemsUoMs(
  items: Array<{ id: string; number: string }>,
): Promise<Map<string, BCItemUoM[]>> {
  if (items.length === 0) return new Map()
  try {
    const token = await getAccessToken()
    const base  = bcBaseUrl()

    const results = await Promise.allSettled(
      items.map(async ({ id, number }) => {
        const res = await fetch(`${base}/items(${id})/itemUnitsOfMeasure`, {
          headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
          next: { revalidate: 300 },  // 5 min — enheder ændres sjældent
        })
        if (!res.ok) return { number, uoms: [] as BCItemUoM[] }
        const data = await res.json()
        const uoms: BCItemUoM[] = (data.value ?? []).map((u: any) => ({
          code:                u.code ?? '',
          displayName:         u.displayName ?? u.code ?? '',
          qtyPerUnitOfMeasure: typeof u.qtyPerUnitOfMeasure === 'number' ? u.qtyPerUnitOfMeasure : 1,
          baseUnitOfMeasure:   u.baseUnitOfMeasure === true,
        }))
        // Sorter: base-enhed først, derefter stigende qtyPerUnitOfMeasure
        uoms.sort((a, b) => {
          if (a.baseUnitOfMeasure && !b.baseUnitOfMeasure) return -1
          if (!a.baseUnitOfMeasure && b.baseUnitOfMeasure) return 1
          return a.qtyPerUnitOfMeasure - b.qtyPerUnitOfMeasure
        })
        return { number, uoms }
      }),
    )

    const map = new Map<string, BCItemUoM[]>()
    for (const r of results) {
      if (r.status === 'fulfilled') map.set(r.value.number, r.value.uoms)
    }
    return map
  } catch {
    return new Map()
  }
}

// ─── Hent én vare ────────────────────────────────────────────────────────────

export async function getItem(id: string): Promise<BCItem | null> {
  const token = await getAccessToken()
  const base  = bcBaseUrl()

  const res = await fetch(`${base}/items(${id})?$expand=picture`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept:        'application/json',
    },
    next: { revalidate: 300 },
  })

  if (!res.ok) return null
  return res.json()
}

// ─── Salgsordrer til leveringsoversigt ───────────────────────────────────────

export interface BCSalesOrderLine {
  id:          string
  itemNo:      string
  description: string
  quantity:    number
  uom:         string
}

export interface BCSalesOrderForDelivery {
  id:                    string
  number:                string
  customerNumber:        string
  customerName:          string
  shipToName:            string
  shipToAddress:         string
  shipToCity:            string
  shipToPostCode:        string
  shipToPhone:           string
  requestedDeliveryDate: string
  postingDate:           string
  status:                string
  totalWeightKg:         number
  deliveryCodes:         string[]  // unikke leveringskoder fra ordrelinjer
  lines:                 BCSalesOrderLine[]
}

export async function getSalesOrdersForDelivery(
  _deliveryDate: string, // YYYY-MM-DD — ignoreres i testperiode
): Promise<BCSalesOrderForDelivery[]> {
  const token = await getAccessToken()
  const base  = bcBaseUrl()

  // TESTPERIODE: Hent ALLE ordrer (ikke Draft) — alle dage vises samlet
  // requestedDeliveryDate er ofte 0001-01-01 i BC; filtrer ikke på dato i test
  const filter = encodeURIComponent(`status ne 'Draft'`)
  const res = await fetch(`${base}/salesOrders?$filter=${filter}&$top=500`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    cache: 'no-store',
  })
  if (!res.ok) {
    const errText = await res.text()
    throw new Error(`BC salesOrders fejl (${res.status}): ${errText}`)
  }
  const data = await res.json()
  console.log(`BC returnerede ${data.value?.length ?? 0} ordrer`)

  const orders: BCSalesOrderForDelivery[] = (data.value ?? []).map((o: any) => ({
    id:                    o.id,
    number:                o.number,
    customerNumber:        o.customerNumber,
    customerName:          o.customerName,
    shipToName:            o.shipToName ?? o.customerName ?? '',
    shipToAddress:         o.shipToAddressLine1 ?? '',
    shipToCity:            o.shipToCity ?? '',
    shipToPostCode:        o.shipToPostalCode ?? '',
    shipToPhone:           o.phoneNumber ?? '',
    requestedDeliveryDate: (!o.requestedDeliveryDate || o.requestedDeliveryDate === '0001-01-01') ? '' : o.requestedDeliveryDate,
    postingDate:           (!o.postingDate           || o.postingDate           === '0001-01-01') ? '' : o.postingDate,
    status:                o.status,
    totalWeightKg:         0,
    // shipmentMethodCode sidder på ordrehovedet — brug det som default leveringskode
    deliveryCodes:         [o.shipmentMethodCode?.trim() || 'VENMARK'],
    lines:                 [],
  }))

  // Hent salgslinjer for alle ordrer parallelt
  // Manglende shipmentMethodCode → "selvmorgen" som standard
  await Promise.all(orders.map(async (order) => {
    try {
      const lRes = await fetch(
        `${base}/salesOrders(${order.id})/salesOrderLines?$select=id,lineObjectNumber,description,quantity,unitOfMeasureCode&$top=200`,
        { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, cache: 'no-store' }
      )
      if (!lRes.ok) return
      const lData = await lRes.json()
      const rawLines: any[] = lData.value ?? []

      order.lines = rawLines
        .filter((l: any) => l.lineObjectNumber)
        .map((l: any) => ({
          id:          l.id,
          itemNo:      l.lineObjectNumber,
          description: l.description ?? l.lineObjectNumber,
          quantity:    l.quantity ?? 0,
          uom:         l.unitOfMeasureCode ?? '',
        }))
    } catch {
      order.deliveryCodes = ['VENMARK']
    }
  }))

  return orders
}

export interface BCSalesOrderLine {
  id:          string
  documentId:  string
  itemNo:      string
  description: string
  quantity:    number
  unitOfMeasure: string
  qtyToShip:   number
  qtyShipped:  number
}

export async function getSalesOrderLines(orderId: string): Promise<BCSalesOrderLine[]> {
  try {
    const token = await getAccessToken()
    const base  = bcBaseUrl()
    const res   = await fetch(
      `${base}/salesOrders(${orderId})/salesOrderLines?$select=id,documentId,itemNo,description,quantity,unitOfMeasureCode,qtyToShip,quantityShipped`,
      { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, next: { revalidate: 60 } }
    )
    if (!res.ok) return []
    const data = await res.json()
    return (data.value ?? []).map((l: any) => ({
      id:            l.id,
      documentId:    l.documentId,
      itemNo:        l.itemNo,
      description:   l.description,
      quantity:      l.quantity,
      unitOfMeasure: l.unitOfMeasureCode,
      qtyToShip:     l.qtyToShip ?? 0,
      qtyShipped:    l.quantityShipped ?? 0,
    }))
  } catch {
    return []
  }
}
