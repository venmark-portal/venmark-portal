import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { Package, Store, Globe, Building2, PlusCircle } from 'lucide-react'
import {
  getCustomerOrders,
  getPortalLineStatuses,
  getPortalOrderAccesses,
  getPortalShipmentMethods,
  getPortalCalendarDays,
  BCPortalLine,
  BCCustomerOrder,
  type BCShipmentMethod,
  type BCCalendarDay,
} from '@/lib/businesscentral'
import { getDeadlineForMethodDelivery, getDeadlineForDelivery } from '@/lib/dateUtils'
import { getParentCustomerNo } from '@/lib/activeCustomer'
import { prisma } from '@/lib/prisma'

/** Lokal YYYY-MM-DD — ikke toISOString, der skifter dato ved midnat. */
function ymdLokal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
import OrderLineStatus, { LINE_COLS, LINE_GRID_CLS } from '@/components/portal/OrderLineStatus'
import { getPortalLang } from '@/lib/i18n/portal/server'
import { makeT, localeOf, type Lang, type TFunc } from '@/lib/i18n/portal/lang'
import { oversaetVarenavne } from '@/lib/i18n/portal/varenavne'
import { ordrerDict } from '@/lib/i18n/portal/dict/ordrer'

export const dynamic = 'force-dynamic'

type OrdrerT = TFunc<keyof typeof ordrerDict.da>

// BC standard salesOrder.status → badge (fallback viser rå værdi). label = ordbogsnøgle.
const STATUS: Record<string, { label: keyof typeof ordrerDict.da; cls: string }> = {
  Draft:              { label: 'stKladde',           cls: 'bg-gray-100  text-gray-600'  },
  InReview:           { label: 'stTilGennemsyn',     cls: 'bg-blue-100  text-blue-700'  },
  Open:               { label: 'stAaben',            cls: 'bg-amber-100 text-amber-700' },
  Released:           { label: 'stFrigivet',         cls: 'bg-green-100 text-green-700' },
  PendingApproval:    { label: 'stAfventerGodk',     cls: 'bg-blue-100  text-blue-700'  },
  PendingPrepayment:  { label: 'stAfventerBetaling', cls: 'bg-blue-100 text-blue-700' },
}

// Danske dato-formater med punktummer: "4. sep." / "tirsdag 4. sep."
const MND = ['jan.', 'feb.', 'mar.', 'apr.', 'maj', 'jun.', 'jul.', 'aug.', 'sep.', 'okt.', 'nov.', 'dec.']
const UGE = ['søndag', 'mandag', 'tirsdag', 'onsdag', 'torsdag', 'fredag', 'lørdag']
// EN/DE: Intl med portalens locale ("4 Sept" / "4. Sept.").
function daDato(iso: string, lang: Lang): string {
  const d = new Date(iso)
  if (lang !== 'da') return d.toLocaleDateString(localeOf(lang), { day: 'numeric', month: 'short' })
  return `${d.getDate()}. ${MND[d.getMonth()]}`
}
function daDatoUge(iso: string, lang: Lang): string {
  const d = new Date(iso)
  if (lang !== 'da') return d.toLocaleDateString(localeOf(lang), { weekday: 'long', day: 'numeric', month: 'short' })
  return `${UGE[d.getDay()]} ${d.getDate()}. ${MND[d.getMonth()]}`
}

interface CustomerRef { customerNo: string; customerName: string }

export default async function MyOrdersPage() {
  const session = await getServerSession(authOptions)
  if (!session?.user) redirect('/portal/login')

  const lang = await getPortalLang()
  const t    = makeT(ordrerDict, lang)
  const fmt  = new Intl.NumberFormat(localeOf(lang), {
    style: 'currency', currency: 'DKK', minimumFractionDigits: 2,
  })

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
        // Varenavne på kundens sprog (BC-varetranslationer); dansk = uændret.
        if (lines) lineMap.set(o.number, await oversaetVarenavne(lines, lang, { nr: 'lineObjectNumber', navn: 'description' }))
      }),
    ),
    bcNumbers.length
      ? prisma.order.findMany({
          where:  { bcOrderNumber: { in: bcNumbers } },
          select: { id: true, bcOrderNumber: true, deadline: true },
        })
      : Promise.resolve([] as { id: string; bcOrderNumber: string | null; deadline: Date }[]),
  ])
  // bcOrderNumber → portal-ordre (Prisma-id + deadline). Bruges til "Tilføj vare"-linket, der
  // slår ordren op på Prisma-id — og til at afgøre oprindelse (portal vs. tastet i BC).
  const portalRowByNumber = new Map(
    portalRows.filter(r => r.bcOrderNumber).map(r => [r.bcOrderNumber as string, r]),
  )
  const portalOrigin = new Set(portalRows.map(r => r.bcOrderNumber).filter(Boolean) as string[])

  // Ordrer tastet i BC (tlf/mail) har ingen portalrække og dermed ingen gemt frist.
  // Den regnes her af leveringsformen — ellers kunne kunden ikke tilføje til en ordre
  // hun selv har ringet ind, hvilket set fra hendes side er samme ordre.
  const om90 = new Date(); om90.setDate(om90.getDate() + 90)
  const [shipMethods, calDays] = await Promise.all([
    getPortalShipmentMethods().catch(() => [] as BCShipmentMethod[]),
    getPortalCalendarDays(ymdLokal(new Date()), ymdLokal(om90)).catch(() => [] as BCCalendarDay[]),
  ])
  function bcFrist(o: BCCustomerOrder): Date | null {
    if (!o.requestedDeliveryDate) return null
    const lev = new Date(`${o.requestedDeliveryDate}T00:00:00`)
    const m = shipMethods.find(x => x.code === o.shipmentMethodCode)
    return m ? getDeadlineForMethodDelivery(lev, m, calDays) : getDeadlineForDelivery(lev)
  }

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
        <h1 className="text-2xl font-bold text-gray-900">{t('titel')}</h1>
        <p className="mt-1 text-sm text-gray-500">
          {totalOrders === 0
            ? t('ingenAabne')
            : t(totalOrders === 1 ? 'antalOrdre1' : 'antalOrdreN', { n: totalOrders }) +
              (hasMultipleStores ? t(groups.length === 1 ? 'fordeltPaa1' : 'fordeltPaaN', { n: groups.length }) : '')}
        </p>
      </div>

      {totalOrders === 0 ? (
        <div className="rounded-xl bg-white px-6 py-16 text-center text-gray-500 ring-1 ring-gray-200">
          <Package size={40} className="mx-auto mb-3 text-gray-300" />
          <p className="font-medium">{t('ingenAabne')}</p>
          <p className="mt-2 text-sm">
            <a href="/portal/bestil" className="text-blue-600 hover:underline">{t('opretFoerste')}</a>
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
                        {t('migSelv')}
                      </span>
                    )}
                    <span className="ml-auto text-xs text-gray-400">
                      {t(orders.length === 1 ? 'antalOrdre1' : 'antalOrdreN', { n: orders.length })} · {fmt.format(storeTotal)}
                    </span>
                  </div>
                )}

                <div className="space-y-3">
                  {sortedOrders.map((order) => {
                    const pr = portalRowByNumber.get(order.number)
                    return (
                      <OrderCard
                        key={order.id || order.number}
                        order={order}
                        lines={lineMap.get(order.number) ?? null}
                        fromBc={!portalOrigin.has(order.number)}
                        deliveryDate={deliveryOf(order)}
                        tilfoejId={pr?.id ?? order.id}
                        deadline={(pr?.deadline ?? bcFrist(order))?.toISOString()}
                        t={t}
                        lang={lang}
                        fmt={fmt}
                      />
                    )
                  })}
                </div>
              </section>
            )
          })}
        </div>
      )}
    </div>
  )
}

function OrderCard({ order, lines, fromBc, deliveryDate, tilfoejId, deadline, t, lang, fmt }: { order: BCCustomerOrder; lines: BCPortalLine[] | null; fromBc: boolean; deliveryDate: string; tilfoejId?: string; deadline?: string; t: OrdrerT; lang: Lang; fmt: Intl.NumberFormat }) {
  const kendt = STATUS[order.status]
  const st = kendt
    ? { label: t(kendt.label), cls: kendt.cls }
    : { label: order.status || t('stAaben'), cls: 'bg-gray-100 text-gray-600' }
  // "Kladde" forvirrer kunden → skjul status-badgen for kladder (vis kun ved reelle statusser).
  const showStatus = order.status !== 'Draft' && !!st.label

  // "Tilføj vare" må når salgshovedet IKKE er færdigpakket (headerPackedBy = "Packed By"
  // på salgshovedet er sat) og fristen ikke er overskredet. Bemærk: enkelte linjer der
  // pakkes (linje-PackedBy) blokerer IKKE — kun hele ordrens Packed By.
  //
  // Det var før også et krav at ordren var bestilt GENNEM portalen. Det gav ingen mening
  // for kunden: har hun ringet en ordre ind om morgenen, er det samme ordre hun vil
  // supplere. Nu gælder det alle åbne ordrer — fristen på en BC-ordre regnes af
  // leveringsformen ude i oversigten.
  const lns = lines ?? []
  const headerPacked = lns.some((l) => (l.headerPackedBy ?? '').trim() !== '')
  const canAddLines = !!tilfoejId && !headerPacked && !!deadline && new Date() < new Date(deadline)

  return (
    <div className="overflow-hidden rounded-xl bg-white ring-1 ring-gray-200">
      <div className="flex items-start gap-3 px-4 py-3">
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-gray-900">
              {deliveryDate
                ? t('levering', { dato: daDatoUge(deliveryDate, lang) })
                : t('ingenLevDato')}
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
                {t('tlfMail')}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">
                <Globe size={10} />
                {t('bestiltOnline')}
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
            {order.orderDate && <>{t('bestiltDato', { dato: daDato(order.orderDate, lang) })}</>}
            {order.amountIncludingTax > 0 && ` · ${t('inklMoms', { beloeb: fmt.format(order.amountIncludingTax) })}`}
            {order.externalDocumentNumber && ` · ${t('ref', { ref: order.externalDocumentNumber })}`}
            {order.orderNote && ` · „${order.orderNote}"`}
          </div>
        </div>
      </div>

      {/* Ordrelinjer som tabel — kolonne-overskrifter + ens bredder (scroller vandret på mobil) */}
      {lines && lines.length > 0 && (
        <div className="border-t border-gray-100 overflow-x-auto">
          <div className="min-w-[720px]">
            {/* Overskrifter */}
            <div className={`${LINE_GRID_CLS} px-4 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-gray-400 border-b border-gray-100 bg-gray-50/50`} style={{ display: 'grid', gridTemplateColumns: LINE_COLS }}>
              <span></span>
              <span>{t('kolVarenr')}</span>
              <span>{t('kolBeskrivelse')}</span>
              <span className="text-right">{t('kolAntal')}</span>
              <span className="text-right">{t('kolPrisEnhed')}</span>
              <span className="text-right">{t('kolBeloeb')}</span>
              <span>{t('kolPakketAf')}</span>
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
                gearType={line.gearType ?? ''}
                catchArea={line.catchArea ?? ''}
              />
            ))}
          </div>
        </div>
      )}

      {/* Tilføj vare til ordren — kun portal-ordrer der ikke er pakket og stadig er inden for fristen */}
      {canAddLines && (
        <div className="border-t border-gray-100 px-4 py-2.5">
          <Link
            href={`/portal/ordrer/${tilfoejId}/tilfoej`}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-blue-600 hover:text-blue-800"
          >
            <PlusCircle size={15} />
            {t('tilfoejVareDenne')}
          </Link>
        </div>
      )}
    </div>
  )
}
