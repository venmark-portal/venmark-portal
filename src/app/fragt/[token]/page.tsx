// Token-beskyttet fragt-dashboard for eksterne fragtmænd.
// Server-rendret — ingen client-side JS afhængighed (god til print).
// Dato-vælger er en simpel <form> der naviguerer via query param.
//
// Adgang: /fragt/{token}?date=YYYY-MM-DD
// Token-validation sker mod BC (slår VM Freight Carrier op).
// Hvis token er ugyldig/udløbet/deaktiveret: 404.
//
// Datagrundlag (jf. FRAGT-PORTAL-API-KONTRAKT.md):
//  - Dag-grundlag = postingDate for BÅDE ordrer og leveringer.
//  - Look-back/historik kræver at vi fletter åbne ordrer (deliveryOrders) MED
//    bogførte leveringer (deliveryShipments). De er komplementære (ordrer bærer
//    kun udestående mængde, leveringer bærer leveret mængde) → læg vægtene sammen,
//    ingen dedup.

import { notFound } from 'next/navigation'
import { getAccessToken } from '@/lib/businesscentral'
import { PrintButton } from './print-button'

export const dynamic = 'force-dynamic'
export const revalidate = 0

interface Carrier {
  id: string
  code: string
  name: string
  codeFilter: string
  contactPerson: string
  email: string
}

// Forenet rækketype efter fletning af ordrer + leveringer.
interface Row {
  id: string
  kind: 'order' | 'shipment'
  number: string
  customerName: string
  shipToName: string
  shipToAddress: string
  shipToCity: string
  shipToPostCode: string
  shipmentMethodCode: string
  totalNetWeightKg: number
  totalBoxes: number
  freightText: string
}

interface ShipmentMethod {
  code: string
  cutoffTime: string  // HH:MM:SS
}

interface Props {
  params: { token: string }
  searchParams: { date?: string; focus?: string }
}

function todayISO(): string {
  const cph = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Copenhagen' })
  return cph
}

function buildShipMethodFilter(codeFilter: string): string {
  // codeFilter format: "LO*,VOBE,GORDON*"
  // Bygger OData $filter: startswith(shipmentMethodCode,'LO') or shipmentMethodCode eq 'VOBE' or startswith(shipmentMethodCode,'GORDON')
  const patterns = codeFilter.split(',').map(p => p.trim().toUpperCase()).filter(Boolean)
  if (patterns.length === 0) return ''
  const clauses = patterns.map(p => {
    if (p === '*') return 'true'
    if (p.endsWith('*')) {
      const prefix = p.slice(0, -1).replace(/'/g, "''")
      return `startswith(shipmentMethodCode,'${prefix}')`
    }
    return `shipmentMethodCode eq '${p.replace(/'/g, "''")}'`
  })
  return clauses.join(' or ')
}

async function bcGet<T>(path: string, token: string): Promise<T> {
  const tenant = process.env.BC_TENANT_ID!
  const env = process.env.BC_ENVIRONMENT_NAME ?? 'production'
  const company = process.env.BC_COMPANY_ID!
  const url = `https://api.businesscentral.dynamics.com/v2.0/${tenant}/${env}/api/venmark/portal/v1.0/companies(${company})${path}`
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    cache: 'no-store',
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`BC ${res.status}: ${body.substring(0, 200)}`)
  }
  return res.json() as Promise<T>
}

async function lookupCarrier(token: string, bearer: string): Promise<Carrier | null> {
  // GUID skal være lowercase med eller uden bindestreger — BC accepterer guid'xxxx'
  const cleanToken = token.toLowerCase().replace(/[{}]/g, '')
  const filter = encodeURIComponent(`token eq ${cleanToken}`)
  // portalFreightCarriers returnerer kun aktive, ikke-udløbne tokens → 0 rækker = 404.
  const data = await bcGet<{ value: Carrier[] }>(`/portalFreightCarriers?$filter=${filter}`, bearer)
  return data.value[0] ?? null
}

// Åbne ordrer (udestående del). Dag-grundlag = postingDate.
async function fetchDeliveryOrders(carrier: Carrier, date: string, bearer: string, shipFilter: string): Promise<Row[]> {
  const filter = encodeURIComponent(`postingDate eq ${date} and (${shipFilter})`)
  const data = await bcGet<{ value: any[] }>(`/deliveryOrders?$filter=${filter}&$top=500`, bearer)
  return (data.value ?? []).map((o): Row => ({
    id: o.id,
    kind: 'order',
    number: o.number,
    customerName: o.customerName ?? '',
    shipToName: o.shipToName ?? '',
    shipToAddress: o.shipToAddress ?? '',
    shipToCity: o.shipToCity ?? '',
    shipToPostCode: o.shipToPostCode ?? '',
    shipmentMethodCode: o.shipmentMethodCode ?? '',
    totalNetWeightKg: o.totalNetWeightKg ?? 0,
    totalBoxes: 0,
    freightText: '',
  }))
}

// Bogførte leveringer (leveret del — look-back/historik). Dag-grundlag = postingDate.
async function fetchDeliveryShipments(date: string, bearer: string, shipFilter: string): Promise<Row[]> {
  const filter = encodeURIComponent(`postingDate eq ${date} and (${shipFilter})`)
  const data = await bcGet<{ value: any[] }>(`/deliveryShipments?$filter=${filter}&$top=500`, bearer)
  return (data.value ?? []).map((s): Row => ({
    id: s.id,
    kind: 'shipment',
    number: s.number,
    customerName: s.customerName ?? '',
    shipToName: s.shipToName ?? '',
    shipToAddress: s.shipToAddress ?? '',
    shipToCity: s.shipToCity ?? '',
    shipToPostCode: s.shipToPostCode ?? '',
    shipmentMethodCode: s.shipmentMethodCode ?? '',
    totalNetWeightKg: s.totalNetWeightKg ?? 0,
    totalBoxes: s.totalBoxes ?? 0,
    freightText: s.freightText ?? '',
  }))
}

async function fetchShipmentMethods(bearer: string): Promise<Map<string, string>> {
  const data = await bcGet<{ value: ShipmentMethod[] }>(`/portalShipmentMethods?$top=500`, bearer)
  const map = new Map<string, string>()
  for (const m of data.value) {
    if (m.cutoffTime) map.set(m.code.toUpperCase(), m.cutoffTime)
  }
  return map
}

interface GroupedRows {
  code: string
  cutoff: string
  rows: Row[]
  totalKg: number
  totalBoxes: number
}

function groupByCode(rows: Row[], cutoffs: Map<string, string>): GroupedRows[] {
  const groups = new Map<string, Row[]>()
  for (const r of rows) {
    const k = r.shipmentMethodCode.toUpperCase()
    if (!groups.has(k)) groups.set(k, [])
    groups.get(k)!.push(r)
  }
  const result: GroupedRows[] = []
  for (const [code, list] of groups) {
    const cutoff = cutoffs.get(code) ?? ''
    // Leveringer først (de er "afsluttede"), derefter åbne ordrer; ellers efter nummer.
    list.sort((a, b) => a.number.localeCompare(b.number))
    const totalKg = list.reduce((s, r) => s + (r.totalNetWeightKg ?? 0), 0)
    const totalBoxes = list.reduce((s, r) => s + (r.totalBoxes ?? 0), 0)
    result.push({ code, cutoff, rows: list, totalKg, totalBoxes })
  }
  // Sortér grupper efter cutoff-tid stigende (tidligst først)
  result.sort((a, b) => a.cutoff.localeCompare(b.cutoff))
  return result
}

function fmtCutoff(c: string): string {
  if (!c) return ''
  // HH:MM:SS → HH:MM
  return c.substring(0, 5)
}

function fmtKg(n: number): string {
  return n.toFixed(1).replace('.', ',') + ' kg'
}

function fmtBoxes(n: number): string {
  if (!n) return ''
  return String(Math.round(n))
}

function addDays(date: string, n: number): string {
  const d = new Date(date + 'T12:00:00')
  d.setDate(d.getDate() + n)
  return d.toISOString().slice(0, 10)
}

export default async function FragtPage({ params, searchParams }: Props) {
  const date = searchParams.date ?? todayISO()
  const focus = searchParams.focus ?? ''

  let bearer: string
  try {
    bearer = await getAccessToken()
  } catch (e: any) {
    return <ErrorView title="BC-forbindelse mislykkedes" body={String(e.message ?? e)} />
  }

  let carrier: Carrier | null
  try {
    carrier = await lookupCarrier(params.token, bearer)
  } catch (e: any) {
    return <ErrorView title="Kunne ikke verificere token" body={String(e.message ?? e)} />
  }

  if (!carrier) notFound()

  const shipFilter = buildShipMethodFilter(carrier.codeFilter)

  let rows: Row[] = []
  let cutoffs = new Map<string, string>()
  let fetchError: string | null = null
  if (shipFilter) {
    try {
      const [orders, shipments, cuts] = await Promise.all([
        fetchDeliveryOrders(carrier, date, bearer, shipFilter),
        fetchDeliveryShipments(date, bearer, shipFilter),
        fetchShipmentMethods(bearer),
      ])
      cutoffs = cuts
      // Flet: åbne ordrer (udestående) + bogførte leveringer (leveret). Komplementære,
      // ingen dedup. Skjul fuldt leverede ordrer (0 kg) — de bæres af leveringsrækken.
      rows = [...orders.filter(o => o.totalNetWeightKg > 0), ...shipments]
    } catch (e: any) {
      fetchError = String(e.message ?? e)
    }
  }

  const groups = groupByCode(rows, cutoffs)
  const dayTotal = groups.reduce((s, g) => s + g.totalKg, 0)
  const dayTotalBoxes = groups.reduce((s, g) => s + g.totalBoxes, 0)
  const dayTotalCount = groups.reduce((s, g) => s + g.rows.length, 0)

  const prevDate = addDays(date, -1)
  const nextDate = addDays(date, +1)

  return (
    <div className="min-h-screen bg-white text-gray-900">
      <div className="max-w-5xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="border-b pb-4 mb-6 print:mb-4">
          <div className="flex items-baseline justify-between flex-wrap gap-2">
            <h1 className="text-2xl font-bold">{carrier.name}</h1>
            <span className="text-sm text-gray-500">Venmark Fisk A/S — fragtliste</span>
          </div>
          <div className="text-sm text-gray-600 mt-1">
            Koder: <code className="font-mono">{carrier.codeFilter}</code>
          </div>
        </div>

        {/* Date navigation */}
        <div className="flex items-center justify-between mb-6 print:hidden">
          <a href={`/fragt/${params.token}?date=${prevDate}`}
             className="px-4 py-2 rounded border hover:bg-gray-50">
            ← Forrige dag
          </a>

          <form method="get" className="flex items-center gap-2">
            <label htmlFor="date" className="text-sm font-medium">Dato:</label>
            <input
              type="date"
              id="date"
              name="date"
              defaultValue={date}
              className="border rounded px-3 py-2"
            />
            <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700">
              Vis
            </button>
            <PrintButton />
          </form>

          <a href={`/fragt/${params.token}?date=${nextDate}`}
             className="px-4 py-2 rounded border hover:bg-gray-50">
            Næste dag →
          </a>
        </div>

        {/* Date label */}
        <div className="mb-4 text-lg font-semibold">
          {new Date(date + 'T12:00:00').toLocaleDateString('da-DK', {
            weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
          })}
        </div>

        {/* Error fetching data */}
        {fetchError && (
          <div className="bg-red-50 border border-red-200 text-red-800 p-4 rounded mb-4">
            <strong>Kunne ikke hente data:</strong> {fetchError}
          </div>
        )}

        {/* Empty state */}
        {!fetchError && groups.length === 0 && (
          <div className="text-center py-12 text-gray-500">
            <p>Ingen fragtordrer for denne dag.</p>
            <p className="text-sm mt-2">Tjek igen senere — listen opdateres løbende.</p>
          </div>
        )}

        {/* Groups */}
        {groups.map(g => (
          <section key={g.code} className="mb-8 print:break-inside-avoid">
            <div className="flex items-baseline justify-between bg-gray-100 px-4 py-2 rounded-t border">
              <div className="font-bold text-lg">
                {g.code}
                {g.cutoff && <span className="ml-3 text-sm text-gray-600 font-normal">Cutoff: {fmtCutoff(g.cutoff)}</span>}
              </div>
              <div className="text-sm">
                <span className="text-gray-600 mr-2">{g.rows.length} leverancer</span>
                {g.totalBoxes > 0 && <span className="text-gray-600 mr-2">{fmtBoxes(g.totalBoxes)} kasser</span>}
                <span className="font-semibold">Sum: {fmtKg(g.totalKg)}</span>
              </div>
            </div>
            <table className="w-full border-x border-b">
              <thead className="bg-gray-50 text-xs uppercase text-gray-600">
                <tr>
                  <th className="text-left px-3 py-2">Bilag</th>
                  <th className="text-left px-3 py-2">Kunde</th>
                  <th className="text-left px-3 py-2">Til adresse</th>
                  <th className="text-left px-3 py-2">By</th>
                  <th className="text-right px-3 py-2">Kasser</th>
                  <th className="text-right px-3 py-2">Kg</th>
                  <th className="text-left px-3 py-2">Fragttekst</th>
                </tr>
              </thead>
              <tbody>
                {g.rows.map(r => {
                  const isFocus = focus && r.number === focus
                  return (
                    <tr key={r.id} className={`border-t ${isFocus ? 'bg-yellow-50' : r.kind === 'shipment' ? 'bg-amber-50/40' : ''}`}>
                      <td className="px-3 py-2 font-mono text-sm">
                        {r.number}
                        {r.kind === 'shipment' && <span className="ml-2 text-xs text-gray-500">(leveret)</span>}
                      </td>
                      <td className="px-3 py-2">{r.shipToName || r.customerName}</td>
                      <td className="px-3 py-2">{r.shipToAddress}</td>
                      <td className="px-3 py-2">{r.shipToPostCode} {r.shipToCity}</td>
                      <td className="px-3 py-2 text-right font-mono">{fmtBoxes(r.totalBoxes)}</td>
                      <td className="px-3 py-2 text-right font-mono">{fmtKg(r.totalNetWeightKg ?? 0)}</td>
                      <td className="px-3 py-2 text-sm font-semibold text-red-600">{r.freightText}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </section>
        ))}

        {/* Day total */}
        {groups.length > 0 && (
          <div className="mt-8 pt-4 border-t-2 border-gray-900 flex items-baseline justify-between">
            <div className="font-bold text-lg">Dag total</div>
            <div className="text-lg">
              <span className="text-gray-600 mr-3">{dayTotalCount} leverancer</span>
              {dayTotalBoxes > 0 && <span className="text-gray-600 mr-3">{fmtBoxes(dayTotalBoxes)} kasser</span>}
              <span className="font-bold text-xl">{fmtKg(dayTotal)}</span>
            </div>
          </div>
        )}

        <footer className="mt-12 pt-4 border-t text-xs text-gray-500 print:hidden">
          Listen viser åbne ordrer + bogførte leveringer for dagen og opdateres løbende.
          Refresh siden for nyeste data.
        </footer>
      </div>
    </div>
  )
}

function ErrorView({ title, body }: { title: string; body: string }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="max-w-md bg-white p-6 rounded shadow border">
        <h1 className="text-xl font-bold mb-2 text-red-700">{title}</h1>
        <p className="text-sm text-gray-700 break-words">{body}</p>
      </div>
    </div>
  )
}
