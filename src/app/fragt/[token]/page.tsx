// Token-beskyttet fragt-dashboard for eksterne fragtmænd.
// Server-rendret — ingen client-side JS afhængighed (god til print).
// Dato-vælger er en simpel <form> der naviguerer via query param.
//
// Adgang: /fragt/{token}?date=YYYY-MM-DD
// Token-validation sker mod BC (slår VM Freight Carrier op).
// Hvis token er ugyldig/udløbet/deaktiveret: 404.

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

interface DeliveryOrder {
  id: string
  number: string
  customerName: string
  shipToName: string
  shipToAddress: string
  shipToCity: string
  shipToPostCode: string
  shipToPhone: string
  shipmentDate: string
  shipmentMethodCode: string
  status: string
  totalNetWeightKg: number
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
  const data = await bcGet<{ value: Carrier[] }>(`/portalFreightCarriers?$filter=${filter}`, bearer)
  return data.value[0] ?? null
}

async function fetchDeliveryOrders(carrier: Carrier, date: string, bearer: string): Promise<DeliveryOrder[]> {
  const shipFilter = buildShipMethodFilter(carrier.codeFilter)
  if (!shipFilter) return []
  const filter = encodeURIComponent(`shipmentDate eq ${date} and (${shipFilter})`)
  const data = await bcGet<{ value: DeliveryOrder[] }>(`/deliveryOrders?$filter=${filter}&$top=500`, bearer)
  return data.value
}

async function fetchShipmentMethods(bearer: string): Promise<Map<string, string>> {
  const data = await bcGet<{ value: ShipmentMethod[] }>(`/portalShipmentMethods?$top=500`, bearer)
  const map = new Map<string, string>()
  for (const m of data.value) {
    if (m.cutoffTime) map.set(m.code.toUpperCase(), m.cutoffTime)
  }
  return map
}

interface GroupedOrders {
  code: string
  cutoff: string
  orders: DeliveryOrder[]
  totalKg: number
}

function groupByCode(orders: DeliveryOrder[], cutoffs: Map<string, string>): GroupedOrders[] {
  const groups = new Map<string, DeliveryOrder[]>()
  for (const o of orders) {
    const k = o.shipmentMethodCode.toUpperCase()
    if (!groups.has(k)) groups.set(k, [])
    groups.get(k)!.push(o)
  }
  const result: GroupedOrders[] = []
  for (const [code, list] of groups) {
    const cutoff = cutoffs.get(code) ?? ''
    list.sort((a, b) => {
      // sort by cutoff time (group-level) — within group, sort by order number
      return a.number.localeCompare(b.number)
    })
    const totalKg = list.reduce((s, o) => s + (o.totalNetWeightKg ?? 0), 0)
    result.push({ code, cutoff, orders: list, totalKg })
  }
  // Sort groups by cutoff time ascending (earliest first)
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

  let orders: DeliveryOrder[] = []
  let cutoffs = new Map<string, string>()
  let fetchError: string | null = null
  try {
    [orders, cutoffs] = await Promise.all([
      fetchDeliveryOrders(carrier, date, bearer),
      fetchShipmentMethods(bearer),
    ])
  } catch (e: any) {
    fetchError = String(e.message ?? e)
  }

  const groups = groupByCode(orders, cutoffs)
  const dayTotal = groups.reduce((s, g) => s + g.totalKg, 0)
  const dayTotalCount = groups.reduce((s, g) => s + g.orders.length, 0)

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
                <span className="text-gray-600 mr-2">{g.orders.length} ordrer</span>
                <span className="font-semibold">Sum: {fmtKg(g.totalKg)}</span>
              </div>
            </div>
            <table className="w-full border-x border-b">
              <thead className="bg-gray-50 text-xs uppercase text-gray-600">
                <tr>
                  <th className="text-left px-3 py-2">Ordrenr</th>
                  <th className="text-left px-3 py-2">Kunde</th>
                  <th className="text-left px-3 py-2">Til adresse</th>
                  <th className="text-left px-3 py-2">By</th>
                  <th className="text-right px-3 py-2">Kg</th>
                </tr>
              </thead>
              <tbody>
                {g.orders.map(o => {
                  const isFocus = focus && o.number === focus
                  return (
                    <tr key={o.id} className={`border-t ${isFocus ? 'bg-yellow-50' : ''}`}>
                      <td className="px-3 py-2 font-mono text-sm">{o.number}</td>
                      <td className="px-3 py-2">{o.shipToName || o.customerName}</td>
                      <td className="px-3 py-2">{o.shipToAddress}</td>
                      <td className="px-3 py-2">{o.shipToPostCode} {o.shipToCity}</td>
                      <td className="px-3 py-2 text-right font-mono">{fmtKg(o.totalNetWeightKg ?? 0)}</td>
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
              <span className="text-gray-600 mr-3">{dayTotalCount} ordrer</span>
              <span className="font-bold text-xl">{fmtKg(dayTotal)}</span>
            </div>
          </div>
        )}

        <footer className="mt-12 pt-4 border-t text-xs text-gray-500 print:hidden">
          Listen opdateres når Venmark tilføjer ordrer i Business Central. Refresh siden for nyeste data.
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
