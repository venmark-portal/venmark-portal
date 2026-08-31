import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { Package, Store, Globe, Building2 } from 'lucide-react'
import {
  getCustomerOrders,
  getPortalLineStatuses,
  getPortalOrderAccesses,
  BCPortalLine,
  BCCustomerOrder,
} from '@/lib/businesscentral'
import { getParentCustomerNo } from '@/lib/activeCustomer'
import { prisma } from '@/lib/prisma'
import OrderLineStatus, { LINE_COLS, LINE_GRID_CLS } from '@/components/portal/OrderLineStatus'

export const dynamic = 'force-dynamic'

// BC standard salesOrder.status → badge (fallback viser rå værdi)
const STATUS: Record<string, { label: string; cls: string }> = {
  Draft:              { label: 'Kladde',          cls: 'bg-gray-100  text-gray-600'  },
  InReview:           { label: 'Til gennemsyn',   cls: 'bg-blue-100  text-blue-700'  },
  Open:               { label: 'Åben',            cls: 'bg-amber-100 text-amber-700' },
  Released:           { label: 'Frigivet',        cls: 'bg-green-100 text-green-700' },
  PendingApproval:    { label: 'Afventer godk.',  cls: 'bg-blue-100  text-blue-700'  },
  PendingPrepayment:  { label: 'Afventer betaling', cls: 'bg-blue-100 text-blue-700' },
}

const fmt = new Intl.NumberFormat('da-DK', {
  style: 'currency', currency: 'DKK', minimumFractionDigits: 2,
})

// Danske dato-formater med punktummer: "4. sep." / "tirsdag 4. sep."
const MND = ['jan.', 'feb.', 'mar.', 'apr.', 'maj', 'jun.', 'jul.', 'aug.', 'sep.', 'okt.', 'nov.', 'dec.']
const UGE = ['søndag', 'mandag', 'tirsdag', 'onsdag', 'torsdag', 'fredag', 'lørdag']
function daDato(iso: string): string {
  const d = new Date(iso)
  return `${d.getDate()}. ${MND[d.getMonth()]}`
}
function daDatoUge(iso: string): string {
  const d = new Date(iso)
  return `${UGE[d.getDay()]} ${d.getDate()}. ${MND[d.getMonth()]}`
}

interface CustomerRef { customerNo: string; customerName: string }

export default async function MyOrdersPage() {
  const session = await getServerSession(authOptions)
  if (!session?.user) redirect('/portal/login')

  const parentNo   = getParentCustomerNo(session)
  const parentName = ((session.user as any).name as string) ?? parentNo

  // Konsolideret: login-kunden selv + alle butikker han har adgang til
  const stores = await getPortalOrderAccesses(parentNo)
  const seen = new Set<string>()
  const customers: CustomerRef[] = [
    { customerNo: parentNo, customerName: parentName },
    ...stores.map(s => ({ customerNo: s.customerNo, customerName: s.customerName })),
  ].filter(c => c.customerNo && !seen.has(c.customerNo) && seen.add(c.customerNo))

  const hasMultipleStores = customers.length > 1

  // Hent ordrer for alle kunder parallelt
  const perCustomer = await Promise.all(
    customers.map(async (c) => ({ customer: c, orders: await getCustomerOrders(c.customerNo) })),
  )

  // Hent portallinjer for alle ordrer parallelt (fulde linjer inkl. status)
  const allOrders = perCustomer.flatMap(pc => pc.orders)
  const lineMap = new Map<string, BCPortalLine[]>()

  // Afgør oprindelse: ordrer oprettet via portalen har en række i portal-DB'en med
  // samme bcOrderNumber. Alt andet er tastet direkte i BC → mærkes "Tastet i BC".
  const bcNumbers = allOrders.map(o => o.number).filter(Boolean)
  const [, portalRows] = await Promise.all([
    Promise.all(
      allOrders.map(async (o) => {
        if (!o.number) return
        const lines = await getPortalLineStatuses(o.number)
        if (lines) lineMap.set(o.number, lines)
      }),
    ),
    bcNumbers.length
      ? prisma.order.findMany({
          where:  { bcOrderNumber: { in: bcNumbers } },
          select: { bcOrderNumber: true },
        })
      : Promise.resolve([] as { bcOrderNumber: string | null }[]),
  ])
  const portalOrigin = new Set(portalRows.map(r => r.bcOrderNumber).filter(Boolean) as string[])

  // Kun grupper med ordrer; login-kunden først, derefter butikker alfabetisk
  const groups = perCustomer
    .filter(pc => pc.orders.length > 0)
    .sort((a, b) => {
      if (a.customer.customerNo === parentNo) return -1
      if (b.customer.customerNo === parentNo) return 1
      return a.customer.customerName.localeCompare(b.customer.customerName, 'da')
    })

  const totalOrders = allOrders.length

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Mine Åbne bestillinger</h1>
        <p className="mt-1 text-sm text-gray-500">
          {totalOrders === 0
            ? 'Ingen åbne ordrer'
            : `${totalOrders} ${totalOrders === 1 ? 'ordre' : 'ordrer'}` +
              (hasMultipleStores ? ` fordelt på ${groups.length} ${groups.length === 1 ? 'butik' : 'butikker'}` : '')}
        </p>
      </div>

      {totalOrders === 0 ? (
        <div className="rounded-xl bg-white px-6 py-16 text-center text-gray-500 ring-1 ring-gray-200">
          <Package size={40} className="mx-auto mb-3 text-gray-300" />
          <p className="font-medium">Ingen åbne ordrer</p>
          <p className="mt-2 text-sm">
            <a href="/portal/bestil" className="text-blue-600 hover:underline">Opret din første bestilling →</a>
          </p>
        </div>
      ) : (
        <div className="space-y-8">
          {groups.map(({ customer, orders }) => {
            const storeTotal = orders.reduce((s, o) => s + (o.amountIncludingTax || 0), 0)
            // Leveringsdato = ordrens Requested Delivery Date, ellers TIDLIGSTE linje-afsendelsesdato
            // (fanger BC-tastede ordrer der ikke har header-leveringsdato → ikke "Ingen leveringsdato").
            const deliveryOf = (o: BCCustomerOrder) =>
              o.requestedDeliveryDate ||
              ((lineMap.get(o.number) ?? []).map(l => l.shipmentDate).filter(Boolean).sort()[0] ?? '')
            // Nærmeste levering ØVERST (i dag først, sen september nederst); udaterede nederst.
            const sortedOrders = orders.slice().sort((a, b) => {
              const da = deliveryOf(a), db = deliveryOf(b)
              if (!da && !db) return 0
              if (!da) return 1
              if (!db) return -1
              return da.localeCompare(db)
            })
            return (
              <section key={customer.customerNo} className="space-y-3">
                {/* Butiks-overskrift — tydelig angivelse af hvilken butik */}
                {hasMultipleStores && (
                  <div className="flex items-center gap-2 border-b border-gray-200 pb-2">
                    <Store size={18} className="shrink-0 text-blue-600" />
                    <h2 className="text-base font-semibold text-gray-900">
                      {customer.customerName || customer.customerNo}
                    </h2>
                    <span className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-xs text-gray-500">
                      {customer.customerNo}
                    </span>
                    {customer.customerNo === parentNo && (
                      <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">
                        mig selv
                      </span>
                    )}
                    <span className="ml-auto text-xs text-gray-400">
                      {orders.length} {orders.length === 1 ? 'ordre' : 'ordrer'} · {fmt.format(storeTotal)}
                    </span>
                  </div>
                )}

                <div className="space-y-3">
                  {sortedOrders.map((order) => (
                    <OrderCard
                      key={order.id || order.number}
                      order={order}
                      lines={lineMap.get(order.number) ?? null}
                      fromBc={!portalOrigin.has(order.number)}
                      deliveryDate={deliveryOf(order)}
                    />
                  ))}
                </div>
              </section>
            )
          })}
        </div>
      )}
    </div>
  )
}

function OrderCard({ order, lines, fromBc, deliveryDate }: { order: BCCustomerOrder; lines: BCPortalLine[] | null; fromBc: boolean; deliveryDate: string }) {
  const st = STATUS[order.status] ?? { label: order.status || 'Åben', cls: 'bg-gray-100 text-gray-600' }
  // "Kladde" forvirrer kunden → skjul status-badgen for kladder (vis kun ved reelle statusser).
  const showStatus = order.status !== 'Draft' && !!st.label

  return (
    <div className="overflow-hidden rounded-xl bg-white ring-1 ring-gray-200">
      <div className="flex items-start gap-3 px-4 py-3">
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-gray-900">
              {deliveryDate
                ? 'Levering ' + daDatoUge(deliveryDate)
                : 'Ingen leveringsdato'}
            </span>
            {showStatus && (
              <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${st.cls}`}>
                {st.label}
              </span>
            )}
            {/* Oprindelse — tydeligt om ordren er tastet i BC (tlf/mail) eller bestilt online */}
            {fromBc ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
                <Building2 size={10} />
                TLF/mail ordre
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">
                <Globe size={10} />
                Bestilt online
              </span>
            )}
            {order.shipmentMethodName && (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
                {order.shipmentMethodName}
              </span>
            )}
            {order.number && (
              <span className="rounded bg-gray-50 px-1.5 py-0.5 font-mono text-xs text-gray-500">
                #{order.number}
              </span>
            )}
          </div>
          <div className="mt-0.5 text-xs text-gray-400">
            {order.orderDate && <>Bestilt {daDato(order.orderDate)}</>}
            {order.amountIncludingTax > 0 && ` · ${fmt.format(order.amountIncludingTax)} inkl. moms`}
            {order.externalDocumentNumber && ` · Ref. ${order.externalDocumentNumber}`}
            {order.orderNote && ` · „${order.orderNote}"`}
          </div>
        </div>
      </div>

      {/* Ordrelinjer som tabel — kolonne-overskrifter + ens bredder (scroller vandret på mobil) */}
      {lines && lines.length > 0 && (
        <div className="border-t border-gray-100 overflow-x-auto">
          <div className="min-w-[720px]">
            {/* Overskrifter */}
            <div className={`${LINE_GRID_CLS} px-4 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-gray-400 border-b border-gray-100 bg-gray-50/50`} style={{ gridTemplateColumns: LINE_COLS }}>
              <span></span>
              <span>Varenr</span>
              <span>Beskrivelse</span>
              <span className="text-right">Antal</span>
              <span className="text-right">Pris/enhed</span>
              <span className="text-right">Beløb</span>
              <span>Pakket af</span>
            </div>
            {lines.map((line) => (
              <OrderLineStatus
                key={line.id || `${line.documentNo}-${line.lineNo}`}
                itemNumber={line.lineObjectNumber}
                itemName={line.description}
                quantity={line.quantity}
                uom={line.unitOfMeasureCode}
                unitPrice={line.unitPrice}
                portalLineStatus={line.portalLineStatus ?? null}
                portalCustomerNote={line.portalCustomerNote ?? null}
                packedBy={line.packedBy ?? ''}
                packedQty={line.packedQty ?? 0}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
