// Fælles regler for ruteplanlægning.
// Bruges BÅDE af admin-siden (klient) og chauffør-API'et (server) — kun rene funktioner her.

/** Koder uden "Egen rute"-flag: gammel regel = LOVENCO eller kode der starter med A, K eller S. */
export const OWN_ROUTE_FALLBACK_RE = /^[AKS]/

/** KØB*-ordrer pakkes i KBH og køres med LOVENCO-bilen. */
export function normalizeCode(code: string): string {
  const u = (code ?? '').toUpperCase().trim()
  return /^KØB/.test(u) ? 'LOVENCO' : u
}

/**
 * Egen rute = kørsel med Venmarks egne biler (vises for chauffører og i ruteplanen).
 * `own` er DeliveryCode.ownRoute pr. kode; null/ukendt kode falder tilbage på den gamle regel.
 */
export function isOwnRouteCode(
  code: string,
  own?: ReadonlyMap<string, boolean | null> | null,
): boolean {
  const u = (code ?? '').toUpperCase().trim()
  if (!u) return false
  const flag = own?.get(u)
  if (flag === true || flag === false) return flag
  return u === 'LOVENCO' || OWN_ROUTE_FALLBACK_RE.test(u)
}

export interface MergeableRow {
  id:           string
  number?:      string
  code:         string
  originalCode: string
  address:      string
  postCode:     string
  weightKg:     number
  isExtraTask?: boolean
}
export interface MergedInfo { id: string; number: string; originalCode: string; weightKg: number }

/**
 * En LOVENCO-ordre og en KØB*-ordre til samme adresse er ét stop:
 * KØB-ordren opsuges i LOVENCO-stoppet (vægt lægges sammen, KØB-nr. huskes til pakkelisten).
 */
export function mergeKobIntoLovenco<T extends MergeableRow>(rows: T[]): (T & { merged?: MergedInfo[] })[] {
  const absorbed = new Set<string>()
  const out: (T & { merged?: MergedInfo[] })[] = []
  for (const row of rows) {
    if (absorbed.has(row.id)) continue
    if (!row.isExtraTask && row.code === 'LOVENCO' && row.originalCode === 'LOVENCO' && row.address) {
      const partner = rows.find(r =>
        !absorbed.has(r.id) && !r.isExtraTask &&
        r.id !== row.id &&
        r.code === 'LOVENCO' &&
        /^KØB/i.test(r.originalCode) &&
        r.address.toLowerCase() === row.address.toLowerCase() &&
        r.postCode === row.postCode
      )
      if (partner) {
        absorbed.add(partner.id)
        out.push({
          ...row,
          weightKg: row.weightKg + partner.weightKg,
          merged: [{ id: partner.id, number: partner.number ?? '', originalCode: partner.originalCode, weightKg: partner.weightKg }],
        })
        continue
      }
    }
    out.push(row)
  }
  return out
}

export type ProfileMap = Record<string, { routeOrder: number; defaultVehicle: number }>

export const DEFAULT_ROUTE_ORDER = 5000

export function vehicleLabelFor(defaultVehicle: number | undefined | null): string {
  return defaultVehicle && defaultVehicle > 0 ? `Bil ${defaultVehicle}` : 'Bil 1'
}

export interface PlannableOrder {
  id:               string
  number:           string
  customerNumber:   string
  customerName:     string
  shipToAddress:    string
  shipToPostCode:   string
  shipToCity:       string
  shipToPhone?:     string
  totalWeightKg:    number
  portalRouteOrder: number
  deliveryCodes:    string[]
}

export interface PlannedStop {
  bcSalesOrderId:       string
  bcSalesOrderNo:       string
  kobSalesOrderNo:      string | null
  bcCustomerNo:         string
  customerName:         string
  customerAddress:      string
  customerPhone:        string | null
  totalWeightKg:        number | null
  deliveryCodeOverride: string
  routeOrder:           number
}
export interface PlannedVehicle { vehicleLabel: string; stops: PlannedStop[] }

/**
 * Automatisk ruteplan ud fra BC-ordrer + kundernes faste rutenumre/standardbiler.
 * Samme opbygning som admin-siden gemmer: bil = kundens standardbil, rækkefølge =
 * kode → bil → rutenummer → navn. Kun "egen rute"-koder kommer med.
 */
export function buildAutoPlan(
  orders: PlannableOrder[],
  profiles: ProfileMap,
  own: ReadonlyMap<string, boolean | null> | null,
): PlannedVehicle[] {
  type Row = MergeableRow & {
    number: string; customerNo: string; customerName: string; city: string
    phone: string | null; bil: string; routeOrder: number
  }
  const rows: Row[] = []
  for (const o of orders) {
    const codes = Array.isArray(o.deliveryCodes) ? o.deliveryCodes : []
    const originalCode = codes.find(c => isOwnRouteCode(c, own)) ?? codes[0] ?? ''
    if (!isOwnRouteCode(originalCode, own)) continue
    const profile = profiles[o.customerNumber ?? '']
    rows.push({
      id:           o.id,
      number:       o.number,
      customerNo:   o.customerNumber ?? '',
      customerName: o.customerName ?? '',
      address:      o.shipToAddress ?? '',
      postCode:     o.shipToPostCode ?? '',
      city:         o.shipToCity ?? '',
      phone:        o.shipToPhone || null,
      weightKg:     o.totalWeightKg ?? 0,
      code:         normalizeCode(originalCode),
      originalCode: originalCode.toUpperCase().trim(),
      bil:          vehicleLabelFor(profile?.defaultVehicle),
      routeOrder:   profile?.routeOrder ?? (o.portalRouteOrder > 0 ? o.portalRouteOrder : DEFAULT_ROUTE_ORDER),
    })
  }

  rows.sort((a, b) =>
    a.code.localeCompare(b.code) ||
    a.bil.localeCompare(b.bil) ||
    a.routeOrder - b.routeOrder ||
    a.customerName.localeCompare(b.customerName, 'da')
  )

  const merged = mergeKobIntoLovenco(rows)
  const byBil = new Map<string, PlannedStop[]>()
  for (const r of merged) {
    if (!byBil.has(r.bil)) byBil.set(r.bil, [])
    byBil.get(r.bil)!.push({
      bcSalesOrderId:       r.id,
      bcSalesOrderNo:       [r.number, ...(r.merged?.map(m => m.number) ?? [])].join(' + '),
      kobSalesOrderNo:      r.merged?.[0]?.number ?? null,
      bcCustomerNo:         r.customerNo,
      customerName:         r.customerName,
      customerAddress:      [r.address, r.postCode, r.city].filter(Boolean).join(', '),
      customerPhone:        r.phone,
      totalWeightKg:        r.weightKg || null,
      deliveryCodeOverride: r.code,
      routeOrder:           r.routeOrder,
    })
  }
  return Array.from(byBil.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([vehicleLabel, stops]) => ({ vehicleLabel, stops }))
}

/**
 * Ny rækkefølge for en delmængde af stops: de valgte stops lægges i den ønskede
 * rækkefølge i de pladser de allerede optager, resten rører vi ikke.
 */
export function applyOrder<T extends { id: string }>(stops: T[], orderedIds: string[]): T[] {
  const wanted = new Set(orderedIds)
  const byId   = new Map(stops.map(s => [s.id, s]))
  const queue  = orderedIds.filter(id => byId.has(id)).map(id => byId.get(id)!)
  return stops.map(s => (wanted.has(s.id) ? queue.shift()! : s))
}
