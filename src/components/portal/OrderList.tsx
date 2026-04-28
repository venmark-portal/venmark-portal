'use client'

import { useState, useCallback, useTransition, useEffect, useRef, useMemo } from 'react'
import {
  Plus, Minus, ShoppingCart, Flame, Search,
  CheckCircle2, ChevronDown, ChevronUp, TrendingDown, Heart, Calendar, RefreshCw, Fish, X,
} from 'lucide-react'
import { formatLongDate, getDeadlineForDelivery, earliestDeliveryForItem } from '@/lib/dateUtils'
import type { BCItem, BCItemAttributeValue, BCItemUoM, BCItemCategory } from '@/lib/businesscentral'
import ItemSearchModal from './ItemSearchModal'

// ─── Typer ────────────────────────────────────────────────────────────────────

type EnrichedItem = BCItem & {
  unitPrice:   number
  attributes?: BCItemAttributeValue[]
  uoms?:       BCItemUoM[]
  pictureId?:  string | null
}

interface PriceTier {
  itemNo:          string
  minimumQuantity: number
  unitPrice:       number
  unitOfMeasure:   string
  startingDate:    string | null
  endingDate:      string | null
}

interface OrderLine {
  item:     EnrichedItem
  quantity: number
  uom:      string   // valgt enhed (UoM kode)
}

interface StandingOrderData {
  id:            string   // SystemId (GUID) — bruges til PATCH
  item:          EnrichedItem
  unitOfMeasure: string
  standingNote:  string
  qtyMonday:     number
  qtyTuesday:    number
  qtyWednesday:  number
  qtyThursday:   number
  qtyFriday:     number
}

interface Props {
  promotions:        { item: EnrichedItem; note: string }[]
  favorites:         EnrichedItem[]
  venmarkItems?:     { item: EnrichedItem; note: string }[]
  standingOrders?:   StandingOrderData[]
  deliveryDays:      Date[]
  customerId:        string
  priceTiers?:       PriceTier[]
  initialFavNos?:    string[]
  requirePoNumber?:  boolean
  itemCutoffs?:      Map<string, { cutoffWeekday: number; cutoffHour: number; itemCategoryCode?: string }>
  allCategories?:    BCItemCategory[]
}

type StandingQtys = { qtyMonday: number; qtyTuesday: number; qtyWednesday: number; qtyThursday: number; qtyFriday: number }

interface SpecialVareItem {
  id: string
  bcItemNumber: string
  itemName: string
  boxEntryNo: number | null
  availableKg: number
  reservedKg: number
  pricePerKg: number | null
  note: string | null
  expiresAt: string
}

interface SpecialReservation {
  reservationId: string
  kg: number
}

// ─── Katalog-kategori-træ ─────────────────────────────────────────────────────

type CatNode = { code: string; displayName: string; children: CatNode[] }

function buildCatTree(cats: BCItemCategory[]): CatNode[] {
  const byCode = new Map<string, CatNode>()
  for (const c of cats) byCode.set(c.code, { code: c.code, displayName: c.displayName, children: [] })
  const roots: CatNode[] = []
  for (const c of cats) {
    const node = byCode.get(c.code)
    if (!node) continue
    if (c.parentCategory && byCode.has(c.parentCategory)) {
      byCode.get(c.parentCategory)!.children.push(node)
    } else {
      roots.push(node)
    }
  }
  function sortNodes(nodes: CatNode[]) {
    nodes.sort((a, b) => a.displayName.localeCompare(b.displayName, 'da'))
    nodes.forEach(n => sortNodes(n.children))
  }
  sortNodes(roots)
  return roots
}

function findCatNode(nodes: CatNode[], code: string): CatNode | null {
  return nodes.find(n => n.code === code) ?? null
}

/** Finder antal fra faste ordrelinjer baseret på ugedag (1=man, 2=tirs, ..., 5=fre) */
function getStandingQty(s: StandingOrderData, weekday: number): number {
  switch (weekday) {
    case 1: return s.qtyMonday
    case 2: return s.qtyTuesday
    case 3: return s.qtyWednesday
    case 4: return s.qtyThursday
    case 5: return s.qtyFriday
    default: return 0
  }
}

// ─── Trappepris-hjælpere ─────────────────────────────────────────────────────

/**
 * Finder gyldig pris for en given mængde, med UoM-konvertering.
 *
 * Logik:
 * 1. Prøver direkte prislinjer for den valgte UoM (f.eks. KRT 10 KG)
 * 2. Falder tilbage på base-enhedspriser (KG) og ganger med qtyPerUom
 */
function resolvePrice(
  itemNo: string, qty: number, tiers: PriceTier[], fallback: number,
  uomCode?: string, qtyPerUom = 1, baseUomCode?: string,
): number {
  if (!tiers.length || qty <= 0) return fallback
  const today = new Date().toISOString().split('T')[0]

  const isBaseUnit = !uomCode || uomCode === baseUomCode || qtyPerUom <= 1

  // ── 1. Direkte priser for den valgte enhed ──────────────────────────────────
  const directTiers = tiers.filter(t =>
    t.itemNo === itemNo &&
    t.minimumQuantity <= qty &&
    (isBaseUnit
      // For base-enhed: acceptér tiers uden enhed ELLER med base-enhed
      ? (!t.unitOfMeasure || !uomCode || t.unitOfMeasure === uomCode)
      // For anden enhed: skal matche præcist
      : t.unitOfMeasure === uomCode) &&
    (!t.startingDate || t.startingDate <= today) &&
    (!t.endingDate   || t.endingDate   >= today),
  )
  if (directTiers.length) return Math.min(...directTiers.map(t => t.unitPrice))

  // ── 2. Fallback: base-enhedspriser × konverteringsfaktor ───────────────────
  if (!isBaseUnit && qtyPerUom > 1) {
    const effectiveBaseQty = qty * qtyPerUom
    const baseTiers = tiers.filter(t =>
      t.itemNo === itemNo &&
      t.minimumQuantity <= effectiveBaseQty &&
      (!t.unitOfMeasure || t.unitOfMeasure === baseUomCode) &&
      (!t.startingDate || t.startingDate <= today) &&
      (!t.endingDate   || t.endingDate   >= today),
    )
    if (baseTiers.length) return Math.min(...baseTiers.map(t => t.unitPrice)) * qtyPerUom
  }

  return isBaseUnit ? fallback : fallback * qtyPerUom
}

/**
 * Bygger visnings-breakpoints for trappepriser, inkl. UoM-konvertering.
 * Returnerer kun niveauer hvor prisen faktisk falder.
 */
function buildDisplayTiers(
  tiers: PriceTier[], itemNo: string, uomCode?: string, today8601?: string,
  qtyPerUom = 1, baseUomCode?: string,
): Array<{ minimumQuantity: number; unitPrice: number }> {
  const t = today8601 ?? new Date().toISOString().split('T')[0]
  const isBaseUnit = !uomCode || uomCode === baseUomCode || qtyPerUom <= 1

  // ── Direkte tiers for den valgte enhed ──────────────────────────────────────
  const direct = tiers.filter(tier =>
    tier.itemNo === itemNo &&
    (isBaseUnit
      ? (!tier.unitOfMeasure || !uomCode || tier.unitOfMeasure === uomCode)
      : tier.unitOfMeasure === uomCode) &&
    (!tier.startingDate || tier.startingDate <= t) &&
    (!tier.endingDate   || tier.endingDate   >= t),
  )

  function buildFromValid(valid: PriceTier[], multiply = 1, divideBreakpoints = 1) {
    const breakpoints = Array.from(new Set(valid.map(v =>
      Math.max(1, Math.ceil(v.minimumQuantity / divideBreakpoints))
    ))).sort((a, b) => a - b)

    const result: Array<{ minimumQuantity: number; unitPrice: number }> = []
    let lastBestPrice = Infinity
    for (const minQty of breakpoints) {
      const effectiveQty = minQty * divideBreakpoints
      const bestPrice = Math.min(...valid.filter(v => v.minimumQuantity <= effectiveQty).map(v => v.unitPrice)) * multiply
      if (bestPrice < lastBestPrice) {
        result.push({ minimumQuantity: minQty, unitPrice: bestPrice })
        lastBestPrice = bestPrice
      }
    }
    return result
  }

  if (direct.length) return buildFromValid(direct)

  // ── Fallback: base-enhedspriser konverteret til KRT-mængder ────────────────
  if (!isBaseUnit && qtyPerUom > 1) {
    const baseTiers = tiers.filter(tier =>
      tier.itemNo === itemNo &&
      (!tier.unitOfMeasure || tier.unitOfMeasure === baseUomCode) &&
      (!tier.startingDate || tier.startingDate <= t) &&
      (!tier.endingDate   || tier.endingDate   >= t),
    )
    if (baseTiers.length) return buildFromValid(baseTiers, qtyPerUom, qtyPerUom)
  }

  return []
}

// ─── Attribut-ikoner ──────────────────────────────────────────────────────────

type AttrDef = { label: string; symbol: string }
const ATTR_DEFS: { pattern: RegExp; def: AttrDef }[] = [
  { pattern: /frost/i,          def: { label: 'Frost',        symbol: '❄'  } },
  { pattern: /vild/i,           def: { label: 'Vildfanget',   symbol: '🎣' } },
  { pattern: /opdr/i,           def: { label: 'Opdrættet',    symbol: '🐟' } },
  { pattern: /øko|eko|organ/i,  def: { label: 'Økologisk',    symbol: '🌿' } },
  { pattern: /msc/i,            def: { label: 'MSC',          symbol: 'Ⓜ'  } },
  { pattern: /asc/i,            def: { label: 'ASC',          symbol: '🅰'  } },
  { pattern: /røg/i,            def: { label: 'Røget',        symbol: '🔥' } },
  { pattern: /fersk/i,          def: { label: 'Fersk',        symbol: '💧' } },
]

function AttrIcon({ attr }: { attr: BCItemAttributeValue }) {
  const v = attr.value?.toLowerCase()
  if (!v || v === 'nej' || v === 'no' || v === '0' || v === 'false') return null
  if (/^\d+$/.test(attr.value.trim())) return null

  for (const { pattern, def } of ATTR_DEFS) {
    if (pattern.test(attr.attributeName)) {
      return (
        <span
          title={`${def.label}: ${attr.value}`}
          className="shrink-0 text-[13px] leading-none cursor-default select-none"
        >
          {def.symbol}
        </span>
      )
    }
  }
  if (attr.value.length <= 2) {
    return (
      <span title={`${attr.attributeName}: ${attr.value}`} className="shrink-0 text-[13px] leading-none">
        {attr.value}
      </span>
    )
  }
  return null
}

// ─── Lagerstatus ──────────────────────────────────────────────────────────────

function StockDot({ inventory }: { inventory: number }) {
  const cfg =
    inventory === 0  ? { color: 'bg-red-400',    label: 'Ingen lager'  } :
    inventory < 10   ? { color: 'bg-orange-400', label: 'Knaphed'      } :
    inventory < 50   ? { color: 'bg-yellow-400', label: 'OK lager'     } :
                       { color: 'bg-green-400',  label: 'Rigeligt'     }
  return (
    <span
      className={`shrink-0 h-2 w-2 rounded-full ${cfg.color}`}
      title={`Lager: ${cfg.label} (${inventory})`}
    />
  )
}

// ─── Thumbnail ────────────────────────────────────────────────────────────────

function ItemThumbnail({ item, onClick }: { item: EnrichedItem; onClick?: () => void }) {
  const url = item.pictureId
    ? `/api/portal/item-image/${item.id}?pictureId=${item.pictureId}`
    : null

  return (
    <button
      onClick={onClick}
      className="shrink-0 h-10 w-10 rounded-lg overflow-hidden border border-gray-200 bg-gray-50 flex items-center justify-center hover:border-blue-300 transition"
      title={item.displayName}
      type="button"
    >
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" className="h-full w-full object-cover" />
      ) : (
        <ShoppingCart size={14} className="text-gray-300" />
      )}
    </button>
  )
}

// ─── Vare-detalje modal ───────────────────────────────────────────────────────

function ItemDetailModal({ item, onClose }: { item: EnrichedItem; onClose: () => void }) {
  const fmt = new Intl.NumberFormat('da-DK', { style: 'currency', currency: 'DKK', minimumFractionDigits: 2 })
  const url = item.pictureId
    ? `/api/portal/item-image/${item.id}?pictureId=${item.pictureId}`
    : null
  const attrs = item.attributes ?? []

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-2xl bg-white shadow-xl overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Billede */}
        {url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt={item.displayName} className="w-full h-48 object-cover" />
        )}
        {!url && (
          <div className="w-full h-24 bg-gray-100 flex items-center justify-center">
            <ShoppingCart size={32} className="text-gray-300" />
          </div>
        )}

        <div className="p-5">
          <p className="text-xs font-mono text-gray-400 mb-1">{item.number}</p>
          <h2 className="text-lg font-bold text-gray-900 mb-3">{item.displayName}</h2>

          {/* Enhed + pris */}
          <div className="flex items-center gap-3 mb-4">
            <span className="rounded-full bg-blue-50 px-3 py-1 text-sm font-medium text-blue-700">
              {item.baseUnitOfMeasureCode}
            </span>
            {item.unitPrice > 0 && (
              <span className="text-sm font-semibold text-gray-700">
                {fmt.format(item.unitPrice)}/{item.baseUnitOfMeasureCode}
              </span>
            )}
          </div>

          {/* Attributter */}
          {attrs.filter(a => {
            const v = a.value?.toLowerCase()
            return v && v !== 'nej' && v !== 'no' && v !== '0' && v !== 'false'
          }).length > 0 && (
            <div className="mb-4">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Egenskaber</p>
              <div className="flex flex-wrap gap-1.5">
                {attrs.filter(a => {
                  const v = a.value?.toLowerCase()
                  return v && v !== 'nej' && v !== 'no' && v !== '0' && v !== 'false'
                }).map((a, i) => (
                  <span key={i} className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
                    {a.attributeName}: {a.value}
                  </span>
                ))}
              </div>
            </div>
          )}

          <button
            onClick={onClose}
            className="mt-2 w-full rounded-xl border border-gray-200 py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-50"
          >
            Luk
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Én kompakt vare-række ────────────────────────────────────────────────────

function OrderRow({
  item, quantity, onQty, priceTiers = [],
  isPromo = false, promoNote = '',
  isVenmark = false, venmarkNote = '',
  isFavorite = false, onToggleFav,
  selectedUom, onUomChange,
  onOpenDetail,
  unavailableLabel = '',
}: {
  item:             EnrichedItem
  quantity:         number
  onQty:            (n: number) => void
  priceTiers?:      PriceTier[]
  isPromo?:         boolean
  promoNote?:       string
  isVenmark?:       boolean
  venmarkNote?:     string
  isFavorite?:      boolean
  onToggleFav?:     () => void
  selectedUom?:     string
  onUomChange?:     (code: string) => void
  onOpenDetail?:    () => void
  unavailableLabel?: string
}) {
  const fmt    = new Intl.NumberFormat('da-DK', { style: 'currency', currency: 'DKK', minimumFractionDigits: 2 })
  const attrs  = item.attributes ?? []
  const uoms   = item.uoms ?? []

  const activeUomCode  = selectedUom ?? item.baseUnitOfMeasureCode
  const activeUomObj   = uoms.find(u => u.code === activeUomCode)
  const qtyPerUom      = activeUomObj?.qtyPerUnitOfMeasure ?? 1
  const baseUomCode    = uoms.find(u => u.baseUnitOfMeasure)?.code ?? item.baseUnitOfMeasureCode

  const effectivePrice = resolvePrice(item.number, Math.max(quantity, 1), priceTiers, item.unitPrice, activeUomCode, qtyPerUom, baseUomCode)

  const today8601    = new Date().toISOString().split('T')[0]
  const displayTiers = buildDisplayTiers(priceTiers, item.number, activeUomCode, today8601, qtyPerUom, baseUomCode)

  const hasRealTiers = displayTiers.length > 1
  const priceChanged = hasRealTiers && quantity > 0 && effectivePrice !== (displayTiers[0]?.unitPrice ?? item.unitPrice)

  const visibleAttrs = attrs.filter(a => {
    const v = a.value?.toLowerCase()
    if (!v || v === 'nej' || v === 'no' || v === '0' || v === 'false') return false
    if (/^\d+$/.test(a.value.trim())) return false
    return true
  }).slice(0, 5)

  const hasMultipleUoms = uoms.length > 1

  return (
    <div className={`px-3 py-2 transition-colors ${unavailableLabel ? 'opacity-60' : ''} ${quantity > 0 ? 'bg-blue-50/50' : 'hover:bg-gray-50/40'}`}>
      {unavailableLabel && (
        <div className="mb-1 flex items-center gap-1 text-[10px] text-amber-600 bg-amber-50 rounded px-1.5 py-0.5 w-fit">
          <Calendar size={9} />
          {unavailableLabel}
        </div>
      )}
      <div className="flex items-center gap-2">

        {/* ── Thumbnail ────────────────────────────────── */}
        <ItemThumbnail item={item} onClick={onOpenDetail} />

        {/* ── Varenavn + info ─────────────────────── */}
        <div className="min-w-0 flex-1">
          {/* Linje 1: navn + attributter */}
          <div className="flex items-center gap-1 min-w-0">
            <StockDot inventory={item.inventory ?? 0} />
            {isPromo && <Flame size={11} className="shrink-0 text-orange-500" />}
            {isVenmark && !isPromo && <span className="shrink-0 text-[12px]" title={venmarkNote || 'Venmark anbefaler'}>⭐</span>}
            <span className="truncate text-sm font-medium text-gray-900 leading-tight">{item.displayName}</span>
            {visibleAttrs.map((attr, i) => <AttrIcon key={i} attr={attr} />)}
          </div>
          {/* Linje 2: nr + aktiv pris + trappepriser */}
          <div className="flex items-center gap-1.5 text-[11px] text-gray-400 mt-0.5 flex-wrap leading-tight">
            <span className="font-mono">{item.number}</span>

            {effectivePrice > 0 && (
              <span className={`font-semibold ${priceChanged ? 'text-blue-600' : 'text-gray-600'}`}>
                {fmt.format(effectivePrice)}/{activeUomCode}
              </span>
            )}

            {hasRealTiers && (
              <span className="flex items-center gap-0.5 flex-wrap">
                <TrendingDown size={9} className="text-emerald-500 shrink-0" />
                {displayTiers.map((t, i) => {
                  const isActive = quantity > 0 && t.minimumQuantity <= quantity &&
                    (i === displayTiers.length - 1 || displayTiers[i + 1].minimumQuantity > quantity)
                  return (
                    <span
                      key={i}
                      className={`rounded px-1 py-0 leading-tight ${
                        isActive
                          ? 'bg-blue-100 text-blue-700 font-semibold'
                          : 'bg-gray-100 text-gray-500'
                      }`}
                      title={`Fra ${t.minimumQuantity} ${activeUomCode}: ${fmt.format(t.unitPrice)}`}
                    >
                      {t.minimumQuantity === 0 ? '1' : t.minimumQuantity}+: {fmt.format(t.unitPrice)}
                    </span>
                  )
                })}
              </span>
            )}

            {promoNote && <span className="italic text-orange-500">"{promoNote}"</span>}
          </div>
        </div>

        {/* ── Enhed + Antal ────────────────────────── */}
        <div className="flex items-center gap-1 shrink-0">
          {/* Enhed FORAN antal */}
          {hasMultipleUoms ? (
            <select
              value={activeUomCode}
              onChange={e => onUomChange?.(e.target.value)}
              className="w-16 rounded border border-gray-200 py-0.5 text-[11px] text-gray-600 focus:border-blue-400 focus:outline-none bg-white cursor-pointer"
              title="Vælg bestillingsenhed"
            >
              {uoms.map(u => (
                <option key={u.code} value={u.code}>
                  {u.code}{u.qtyPerUnitOfMeasure !== 1 ? ` (×${u.qtyPerUnitOfMeasure})` : ''}
                </option>
              ))}
            </select>
          ) : (
            <span className="w-6 text-[11px] text-gray-400 text-right">{item.baseUnitOfMeasureCode}</span>
          )}

          {/* Minus / antal-felt / Plus / +10 / +50 */}
          <button
            onClick={() => onQty(Math.max(0, quantity - 1))}
            disabled={quantity === 0}
            className="h-7 w-7 flex items-center justify-center rounded-full border border-gray-200 text-gray-500 hover:bg-gray-100 disabled:opacity-25 active:scale-95 transition"
          >
            <Minus size={12} />
          </button>
          <input
            type="number"
            min={0}
            value={quantity || ''}
            placeholder="0"
            onChange={(e) => onQty(Math.max(0, parseInt(e.target.value) || 0))}
            className="w-10 rounded border border-gray-200 py-1 text-center text-sm font-semibold focus:border-blue-400 focus:outline-none"
          />
          <button
            onClick={() => onQty(quantity + 1)}
            className="h-7 w-7 flex items-center justify-center rounded-full border border-gray-200 text-gray-500 hover:bg-gray-100 active:scale-95 transition"
          >
            <Plus size={12} />
          </button>
          <button
            onClick={() => onQty(quantity + 10)}
            className="h-7 px-1.5 flex items-center justify-center rounded-full border border-gray-200 text-[11px] font-semibold text-gray-500 hover:bg-gray-100 active:scale-95 transition"
          >
            +10
          </button>
          <button
            onClick={() => onQty(quantity + 50)}
            className="h-7 px-1.5 flex items-center justify-center rounded-full border border-gray-200 text-[11px] font-semibold text-gray-500 hover:bg-gray-100 active:scale-95 transition"
          >
            +50
          </button>
        </div>

        {/* ── Favorit-hjerte yderst til højre ─────── */}
        {onToggleFav && (
          <button
            onClick={onToggleFav}
            className={`shrink-0 p-1 rounded-full transition-colors ${
              isFavorite ? 'text-red-400 hover:text-red-300' : 'text-gray-200 hover:text-red-300'
            }`}
            title={isFavorite ? 'Fjern favorit' : 'Tilføj favorit'}
          >
            <Heart size={15} fill={isFavorite ? 'currentColor' : 'none'} />
          </button>
        )}

      </div>
    </div>
  )
}

// ─── Leveringsdato-vælger ─────────────────────────────────────────────────────

function DeliveryPicker({
  deliveryDays, selectedDay, onSelect,
}: {
  deliveryDays: Date[]
  selectedDay:  number
  onSelect:     (idx: number) => void
}) {
  const now = new Date()
  const [showMore, setShowMore] = useState(false)

  // Hurtige 3 knapper (første 3 gyldige dage)
  const quickDays = deliveryDays.slice(0, 3).filter(d => now <= getDeadlineForDelivery(d))

  // Resterende dage (fra indeks 3 og frem), kun ikke-forpassede
  const moreDays = deliveryDays
    .map((d, i) => ({ d, i }))
    .slice(3)
    .filter(({ d }) => now <= getDeadlineForDelivery(d))

  // Er valgt dag ud over de 3 hurtige?
  const moreSelected = selectedDay >= 3

  function formatDay(day: Date) {
    return day.toLocaleDateString('da-DK', { weekday: 'short' }).replace('.', '')
  }

  return (
    <div className="rounded-xl bg-white p-4 ring-1 ring-gray-200">
      <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500">
        Vælg leveringsdato
      </p>

      {/* Hurtige knapper + "Mere"-knap på samme linje */}
      <div className="flex flex-wrap gap-2">
        {quickDays.map((day, i) => {
          const dl         = getDeadlineForDelivery(day)
          const isSelected = i === selectedDay
          return (
            <button
              key={i}
              onClick={() => { onSelect(i); setShowMore(false) }}
              className={`flex shrink-0 flex-col items-center rounded-xl px-4 py-2 text-sm font-medium transition ${
                isSelected ? 'bg-blue-600 text-white shadow-sm' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              <span className="font-bold">{formatDay(day)}</span>
              <span className="text-xs opacity-80">
                {day.toLocaleDateString('da-DK', { day: 'numeric', month: 'short' })}
              </span>
              <span className="mt-0.5 text-[10px] opacity-70">
                frist {dl.toLocaleTimeString('da-DK', { hour: '2-digit', minute: '2-digit' })}
              </span>
            </button>
          )
        })}

        {/* "Mere"-knap */}
        {moreDays.length > 0 && (
          <button
            onClick={() => setShowMore(v => !v)}
            className={`flex shrink-0 flex-col items-center justify-center rounded-xl px-3 py-2 text-sm font-medium transition gap-0.5 ${
              moreSelected
                ? 'bg-blue-600 text-white shadow-sm'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
            title="Vælg en anden dato"
          >
            <Calendar size={15} />
            <span className="text-[11px]">
              {moreSelected
                ? deliveryDays[selectedDay]?.toLocaleDateString('da-DK', { day: 'numeric', month: 'short' })
                : 'Mere'}
            </span>
          </button>
        )}
      </div>

      {/* Udvidet dato-liste — samme knapstil som hurtige knapper */}
      {showMore && (
        <div className="mt-2 flex flex-wrap gap-2 max-h-52 overflow-y-auto rounded-lg border border-gray-100 bg-gray-50/50 p-2">
          {moreDays.map(({ d: day, i: dlIdx }) => {
            const dl         = getDeadlineForDelivery(day)
            const isSelected = dlIdx === selectedDay
            return (
              <button
                key={dlIdx}
                onClick={() => { onSelect(dlIdx); setShowMore(false) }}
                className={`flex shrink-0 flex-col items-center rounded-xl px-4 py-2 text-sm font-medium transition ${
                  isSelected ? 'bg-blue-600 text-white shadow-sm' : 'bg-white text-gray-700 hover:bg-blue-50 border border-gray-200'
                }`}
              >
                <span className="font-bold">{formatDay(day)}</span>
                <span className="text-xs opacity-80">
                  {day.toLocaleDateString('da-DK', { day: 'numeric', month: 'short' })}
                </span>
                <span className="mt-0.5 text-[10px] opacity-70">
                  frist {dl.toLocaleTimeString('da-DK', { hour: '2-digit', minute: '2-digit' })}
                </span>
              </button>
            )
          })}
        </div>
      )}

      {/* Valgt dato info */}
      {deliveryDays[selectedDay] && (() => {
        const dl     = getDeadlineForDelivery(deliveryDays[selectedDay])
        const isPast = now > dl
        return (
          <p className={`mt-2 text-xs ${isPast ? 'text-red-500' : 'text-gray-400'}`}>
            {isPast
              ? `⛔ Deadline er overskredet for ${formatLongDate(deliveryDays[selectedDay])}`
              : `📅 Levering ${formatLongDate(deliveryDays[selectedDay])} — bestil inden kl. ${dl.toLocaleTimeString('da-DK', { hour: '2-digit', minute: '2-digit' })}`
            }
          </p>
        )
      })()}
    </div>
  )
}

// ─── Hoved-komponent ──────────────────────────────────────────────────────────

export default function OrderList({
  promotions, favorites, venmarkItems = [], standingOrders = [], deliveryDays, customerId, priceTiers = [], initialFavNos = [],
  requirePoNumber = false, itemCutoffs = new Map(), allCategories = [],
}: Props) {
  // Tjek om en vare kan leveres på den valgte dato
  function itemAvailable(itemNo: string, deliveryDate: Date | undefined): boolean {
    if (!deliveryDate) return true
    const cutoff = itemCutoffs.get(itemNo)
    if (!cutoff) return true // ingen speciel frist — standard logik gælder
    const earliest = earliestDeliveryForItem(cutoff.cutoffWeekday, cutoff.cutoffHour)
    return deliveryDate >= earliest
  }

  const firstValid = deliveryDays.findIndex(d => new Date() <= getDeadlineForDelivery(d))
  const [selectedDay, setSelectedDay] = useState(Math.max(0, firstValid))

  // Beregn ugedag for valgt leveringsdato (1=man ... 5=fre)
  const deliveryWeekday = deliveryDays[Math.max(0, firstValid)]
    ? (() => { const d = deliveryDays[Math.max(0, firstValid)]; return d.getDay() === 0 ? 7 : d.getDay() })()
    : 1

  const [lines, setLines]             = useState<Map<string, OrderLine>>(() => {
    // Foreslå mængder fra faste ordrelinjer for første gyldige leveringsdag
    const m = new Map<string, OrderLine>()
    for (const s of standingOrders) {
      const qty = getStandingQty(s, deliveryWeekday)
      if (qty > 0) {
        m.set(s.item.number, { item: s.item, quantity: qty, uom: s.unitOfMeasure || s.item.baseUnitOfMeasureCode })
      }
    }
    return m
  })
  const [lineUoms, setLineUoms]       = useState<Map<string, string>>(() => {
    const m = new Map<string, string>()
    for (const s of standingOrders) {
      if (s.unitOfMeasure) m.set(s.item.number, s.unitOfMeasure)
    }
    return m
  })
  const [favSet, setFavSet]           = useState<Set<string>>(() => new Set(initialFavNos))
  const [catalogPath, setCatalogPath]               = useState<string[]>([])
  const [categoryItems, setCategoryItems]           = useState<EnrichedItem[]>([])
  const [categoryPriceTiers, setCategoryPriceTiers] = useState<PriceTier[]>([])
  const [categoryLoading, setCategoryLoading]       = useState(false)
  const [showSearch, setShowSearch]     = useState(false)
  const [showPromos, setShowPromos]     = useState(true)
  const [showStanding, setShowStanding] = useState(true)
  const [submitting, setSubmitting]     = useState(false)
  const [submitted, setSubmitted]     = useState(false)
  const [error, setError]             = useState('')
  const [notes,      setNotes]        = useState('')
  const [driverNote, setDriverNote]   = useState('')
  const [poNumber,   setPoNumber]     = useState('')
  const [detailItem, setDetailItem]           = useState<EnrichedItem | null>(null)
  const [, startTransition]                   = useTransition()
  const [specialVarer, setSpecialVarer]       = useState<SpecialVareItem[]>([])
  const [specialReservations, setSpecialReservations] = useState<Map<string, SpecialReservation>>(new Map())
  const [specialReserving, setSpecialReserving] = useState<string | null>(null) // specialVareId under reservation
  const [showSpecial, setShowSpecial]         = useState(true)

  // (Faste ordrer redigeres i BC — ikke fra portalen)

  const now = new Date()

  // ── Tjek om en vare er tilgængelig for valgt leveringsdato ──────────────────
  function isItemAvailable(itemNo: string, deliveryDate: Date): boolean {
    const cutoff = itemCutoffs.get(itemNo)
    if (!cutoff || cutoff.cutoffWeekday === 0) return true // ingen særlig frist
    const earliest = earliestDeliveryForItem(cutoff.cutoffWeekday, cutoff.cutoffHour, now)
    return deliveryDate >= earliest
  }

  // Navn på ugedag for cutoff (til fejlbesked)
  const weekdayNames = ['', 'mandag', 'tirsdag', 'onsdag', 'torsdag', 'fredag']
  function cutoffLabel(itemNo: string): string {
    const cutoff = itemCutoffs.get(itemNo)
    if (!cutoff || cutoff.cutoffWeekday === 0) return ''
    return `Bestillingsfrist: ${weekdayNames[cutoff.cutoffWeekday]} kl. ${String(cutoff.cutoffHour).padStart(2, '0')}:00`
  }

  const deliveryDate    = deliveryDays[selectedDay]
  const deadline        = deliveryDate ? getDeadlineForDelivery(deliveryDate) : null
  // Beregn ugedag for valgt leveringsdato (mandag=1 ... fredag=5, weekend→0)
  const selectedWeekday = deliveryDate
    ? (deliveryDate.getDay() === 0 ? 7 : deliveryDate.getDay())
    : 0
  const pastDeadline = deadline ? now > deadline : false

  // ── Antal ───────────────────────────────────────────────────────────────────
  const setQty = useCallback((item: EnrichedItem, qty: number, fromStanding = false) => {
    if (!fromStanding) manuallyEdited.current.add(item.number)
    setLines(prev => {
      const next = new Map(prev)
      if (qty === 0) next.delete(item.number)
      else {
        const existing = prev.get(item.number)
        next.set(item.number, { item, quantity: qty, uom: existing?.uom ?? item.baseUnitOfMeasureCode })
      }
      return next
    })
  }, [])

  const setLineUom = useCallback((item: EnrichedItem, uomCode: string) => {
    setLineUoms(prev => new Map(prev).set(item.number, uomCode))
    setLines(prev => {
      const existing = prev.get(item.number)
      if (!existing) return prev
      return new Map(prev).set(item.number, { ...existing, uom: uomCode })
    })
  }, [])

  const getQty = (itemNumber: string) => lines.get(itemNumber)?.quantity ?? 0

  // ── Hent specialvarer ved mount og hvert 60. sekund ────────────────────────
  useEffect(() => {
    let cancelled = false
    async function fetchSpecial() {
      try {
        const res = await fetch('/api/specialvarer')
        if (!res.ok || cancelled) return
        const data: SpecialVareItem[] = await res.json()
        if (!cancelled) {
          setSpecialVarer(data)
        }
      } catch { /* stil */ }
    }
    fetchSpecial()
    const interval = setInterval(fetchSpecial, 60_000)
    return () => { cancelled = true; clearInterval(interval) }
  }, [])

  async function handleReserver(vare: SpecialVareItem) {
    // Kunden tager hele det resterende parti
    const kg = vare.availableKg - vare.reservedKg
    if (kg <= 0) return
    setSpecialReserving(vare.id)
    try {
      const res = await fetch('/api/specialvarer/reserver', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ specialVareId: vare.id, kg }),
      })
      if (!res.ok) {
        const err = await res.json()
        setError(err.error ?? 'Reservation fejlede')
        return
      }
      const data = await res.json()
      setSpecialReservations(prev => new Map(prev).set(vare.id, { reservationId: data.reservationId, kg }))
      setSpecialVarer(prev => prev.map(v => v.id === vare.id
        ? { ...v, reservedKg: v.reservedKg + kg }
        : v
      ))
      // Ordrelinjenavn inkl. kassesnummer så lager/BC ved hvilken kasse
      const lineName = vare.boxEntryNo
        ? `${vare.itemName} (kasse #${vare.boxEntryNo})`
        : vare.itemName
      const fakeItem: EnrichedItem = {
        id: `sv-${vare.id}`,
        number: vare.bcItemNumber,
        displayName: lineName,
        unitPrice: vare.pricePerKg ?? 0,
        baseUnitOfMeasureCode: 'KG',
        inventory: 9999,
        blocked: false,
        itemCategoryCode: '',
        productGroupCode: '',
        picture: null,
        attributes: [],
        uoms: [{ code: 'KG', displayName: 'KG', qtyPerUnitOfMeasure: 1, baseUnitOfMeasure: true }],
        pictureId: null,
      } as any
      setLines(prev => new Map(prev).set(vare.bcItemNumber, { item: fakeItem, quantity: kg, uom: 'KG' }))
      setLineUoms(prev => new Map(prev).set(vare.bcItemNumber, 'KG'))
    } catch {
      setError('Serverfejl ved reservation')
    } finally {
      setSpecialReserving(null)
    }
  }

  async function handleCancelReservation(vare: SpecialVareItem) {
    const res = specialReservations.get(vare.id)
    if (!res) return
    try {
      await fetch('/api/specialvarer/reserver', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reservationId: res.reservationId }),
      })
      setSpecialReservations(prev => { const n = new Map(prev); n.delete(vare.id); return n })
      setSpecialVarer(prev => prev.map(v => v.id === vare.id
        ? { ...v, reservedKg: Math.max(0, v.reservedKg - res.kg) }
        : v
      ))
      setLines(prev => { const n = new Map(prev); n.delete(vare.bcItemNumber); return n })
    } catch { /* stil */ }
  }

  // ── Opdater faste ordrelinjer når leveringsdagen skifter ─────────────────────
  // Sæt der tracker hvilke varenumre brugeren har manuelt redigeret
  const manuallyEdited = useRef<Set<string>>(new Set())

  useEffect(() => {
    if (standingOrders.length === 0 || selectedWeekday === 0) return
    setLines(prev => {
      const next = new Map(prev)
      for (const s of standingOrders) {
        // Spring over varer brugeren selv har ændret
        if (manuallyEdited.current.has(s.item.number)) continue
        const newQty = getStandingQty(s, selectedWeekday)
        if (newQty > 0) {
          const existing = next.get(s.item.number)
          next.set(s.item.number, {
            item: s.item,
            quantity: newQty,
            uom: existing?.uom ?? (s.unitOfMeasure || s.item.baseUnitOfMeasureCode),
          })
        } else {
          next.delete(s.item.number)
        }
      }
      return next
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedWeekday])

  // ── Favorit-toggle ──────────────────────────────────────────────────────────
  function toggleFavorite(item: EnrichedItem) {
    const newVal = !favSet.has(item.number)
    setFavSet(prev => {
      const s = new Set(prev)
      if (newVal) { s.add(item.number) } else { s.delete(item.number) }
      return s
    })
    startTransition(() => {
      fetch('/api/portal/favorites', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ itemNo: item.number, itemName: item.displayName, isFavorite: newVal }),
      }).catch(() => {
        setFavSet(prev => {
          const s = new Set(prev)
          if (newVal) { s.delete(item.number) } else { s.add(item.number) }
          return s
        })
      })
    })
  }

  // ── Tilføj via søgning ──────────────────────────────────────────────────────
  function addSearchedItems(items: { item: EnrichedItem; quantity: number }[]) {
    setLines(prev => {
      const next = new Map(prev)
      for (const { item, quantity } of items) {
        const existing = next.get(item.number)
        next.set(item.number, { item, quantity: (existing?.quantity ?? 0) + quantity, uom: existing?.uom ?? item.baseUnitOfMeasureCode })
      }
      return next
    })
    setShowSearch(false)
  }

  // ── Indsend ordre ────────────────────────────────────────────────────────────
  async function handleSubmit() {
    if (lines.size === 0 || !deliveryDate) return
    setSubmitting(true)
    setError('')

    const orderLines = Array.from(lines.values()).map(l => {
      const uomCode     = lineUoms.get(l.item.number) ?? l.item.baseUnitOfMeasureCode
      const uomObj      = l.item.uoms?.find(u => u.code === uomCode)
      const qtyPerUom   = uomObj?.qtyPerUnitOfMeasure ?? 1
      const baseUomCode = l.item.uoms?.find(u => u.baseUnitOfMeasure)?.code ?? l.item.baseUnitOfMeasureCode
      return {
        bcItemNumber: l.item.number,
        itemName:     l.item.displayName,
        quantity:     l.quantity,
        uom:          uomCode,
        unitPrice:    resolvePrice(l.item.number, l.quantity, priceTiers, l.item.unitPrice, uomCode, qtyPerUom, baseUomCode),
      }
    })

    try {
      const res = await fetch('/api/portal/order', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          deliveryDate: deliveryDate.toISOString(), notes, driverNote, poNumber, lines: orderLines,
          reservationIds: Array.from(specialReservations.values()).map(r => r.reservationId),
        }),
      })
      if (!res.ok) throw new Error(await res.text())
      setSubmitted(true)
    } catch (e: any) {
      setError(e.message ?? 'Ukendt fejl — prøv igen')
    } finally {
      setSubmitting(false)
    }
  }

  // ── Totaler ──────────────────────────────────────────────────────────────────
  const activeLines = Array.from(lines.values())
  const totalLines  = activeLines.length
  const totalAmount = activeLines.reduce((s, l) => {
    const uomCode    = lineUoms.get(l.item.number) ?? l.item.baseUnitOfMeasureCode
    const uomObj     = l.item.uoms?.find(u => u.code === uomCode)
    const qtyPerUom  = uomObj?.qtyPerUnitOfMeasure ?? 1
    const baseUomCode = l.item.uoms?.find(u => u.baseUnitOfMeasure)?.code ?? l.item.baseUnitOfMeasureCode
    return s + resolvePrice(l.item.number, l.quantity, priceTiers, l.item.unitPrice, uomCode, qtyPerUom, baseUomCode) * l.quantity
  }, 0)

  const fmt = new Intl.NumberFormat('da-DK', { style: 'currency', currency: 'DKK', minimumFractionDigits: 2 })

  const promoNos    = new Set(promotions.map(p => p.item.number))
  const favNos      = new Set(favorites.map(f => f.number))
  const venmarkNos  = new Set(venmarkItems.map(v => v.item.number))
  const standingNos = new Set(standingOrders.map(s => s.item.number))

  // Flettet liste: favoritter + Venmark-anbefalede, dedupliceret og sorteret efter varenummer
  const mergedFavVenmark = (() => {
    type MEntry = { item: EnrichedItem; isVenmark: boolean; vNote: string }
    const mm = new Map<string, MEntry>()
    for (const f of favorites.filter(f => !promoNos.has(f.number)))
      mm.set(f.number, { item: f, isVenmark: false, vNote: '' })
    for (const { item, note } of venmarkItems.filter(v => !promoNos.has(v.item.number))) {
      const e = mm.get(item.number)
      if (e) { e.isVenmark = true; e.vNote = note }
      else mm.set(item.number, { item, isVenmark: true, vNote: note })
    }
    return Array.from(mm.values()).sort((a, b) => a.item.number.localeCompare(b.item.number))
  })()

  // ── Katalog-navigation ───────────────────────────────────────────────────────
  const catTree        = useMemo(() => buildCatTree(allCategories), [allCategories])
  const activeCategory = catalogPath.length > 0 ? catalogPath[catalogPath.length - 1] : ''
  const isCatalogMode  = catalogPath.length > 0
  const l0Cats         = catTree
  const l1Node         = catalogPath.length >= 1 ? findCatNode(l0Cats, catalogPath[0]) : null
  const l2Node         = catalogPath.length >= 2 ? findCatNode(l1Node?.children ?? [], catalogPath[1]) : null

  // Hent varer i valgt kategori ved navigation
  useEffect(() => {
    if (!activeCategory) {
      setCategoryItems([])
      setCategoryPriceTiers([])
      return
    }
    let cancelled = false
    setCategoryLoading(true)
    fetch(`/api/portal/category-items?category=${encodeURIComponent(activeCategory)}`)
      .then(r => r.ok ? r.json() : { items: [], priceTiers: [] })
      .then(data => {
        if (!cancelled) {
          setCategoryItems(data.items ?? [])
          setCategoryPriceTiers(data.priceTiers ?? [])
        }
      })
      .catch(() => { if (!cancelled) { setCategoryItems([]); setCategoryPriceTiers([]) } })
      .finally(() => { if (!cancelled) setCategoryLoading(false) })
    return () => { cancelled = true }
  }, [activeCategory])

  const specialReservedNos = new Set(
    Array.from(specialReservations.keys())
      .map(vId => specialVarer.find(v => v.id === vId)?.bcItemNumber)
      .filter(Boolean) as string[]
  )

  const searchedLines = Array.from(lines.values()).filter(
    l => !promoNos.has(l.item.number) && !favNos.has(l.item.number) && !venmarkNos.has(l.item.number) && !standingNos.has(l.item.number) && !specialReservedNos.has(l.item.number)
  )

  // Ugedagsnavn til sektion-header
  const weekdayName = ['', 'Mandag', 'Tirsdag', 'Onsdag', 'Torsdag', 'Fredag', 'Lørdag', 'Søndag'][selectedWeekday] ?? ''

  // ─── SUCCES ──────────────────────────────────────────────────────────────────
  if (submitted) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 rounded-2xl bg-white py-16 text-center ring-1 ring-gray-200">
        <CheckCircle2 size={52} className="text-green-500" />
        <div>
          <h2 className="text-xl font-bold text-gray-900">Bestilling indsendt!</h2>
          <p className="mt-1 text-sm text-gray-500">Levering: {formatLongDate(deliveryDate)}</p>
          <p className="mt-0.5 text-sm text-gray-400">Vi bekræfter snarest muligt</p>
        </div>
        <div className="flex gap-3 mt-2">
          <a href="/portal" className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
            Tilbage til oversigt
          </a>
          <button
            onClick={() => { setSubmitted(false); setLines(new Map()); setNotes('') }}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            Ny bestilling
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Leveringsdato */}
      <DeliveryPicker deliveryDays={deliveryDays} selectedDay={selectedDay} onSelect={setSelectedDay} />

      {/* Vareliste */}
      <div className="overflow-hidden rounded-xl bg-white ring-1 ring-gray-200">

        {/* Legende */}
        <div className="flex items-center gap-3 px-3 py-1.5 bg-gray-50 border-b border-gray-100 text-[10px] text-gray-400">
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-green-400 inline-block" />Rigeligt</span>
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-yellow-400 inline-block" />OK</span>
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-orange-400 inline-block" />Knaphed</span>
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-red-400 inline-block" />Intet</span>
          <span className="flex items-center gap-1 ml-auto"><TrendingDown size={10} />= lavere pris ved større mængde</span>
        </div>

        {/* Katalog-navigation */}
        <div className="border-b border-gray-100">
          {/* Niveau 0: Mine varer + top-niveau kategorier */}
          <div className="flex gap-1 px-3 py-2 overflow-x-auto">
            <button
              onClick={() => setCatalogPath([])}
              className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                !isCatalogMode ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              Mine varer
            </button>
            {l0Cats.map(cat => (
              <button
                key={cat.code}
                onClick={() => setCatalogPath([cat.code])}
                className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                  catalogPath[0] === cat.code ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {cat.displayName}
              </button>
            ))}
          </div>

          {/* Niveau 1: underkategorier */}
          {l1Node && l1Node.children.length > 0 && (
            <div className="flex gap-1 px-3 py-1.5 overflow-x-auto bg-gray-50/60 border-t border-gray-100">
              <span className="shrink-0 text-[10px] text-gray-400 self-center pr-1 whitespace-nowrap">
                {l1Node.displayName} ›
              </span>
              {l1Node.children.map(child => (
                <button
                  key={child.code}
                  onClick={() => setCatalogPath([catalogPath[0], child.code])}
                  className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                    catalogPath[1] === child.code
                      ? 'bg-blue-500 text-white'
                      : 'bg-white text-gray-600 hover:bg-gray-100 border border-gray-200'
                  }`}
                >
                  {child.displayName}
                </button>
              ))}
            </div>
          )}

          {/* Niveau 2: under-underkategorier */}
          {l2Node && l2Node.children.length > 0 && (
            <div className="flex gap-1 px-3 py-1.5 overflow-x-auto bg-gray-50/80 border-t border-gray-100">
              <span className="shrink-0 text-[10px] text-gray-400 self-center pr-1 whitespace-nowrap">
                {l2Node.displayName} ›
              </span>
              {l2Node.children.map(child => (
                <button
                  key={child.code}
                  onClick={() => setCatalogPath([catalogPath[0], catalogPath[1], child.code])}
                  className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                    catalogPath[2] === child.code
                      ? 'bg-blue-400 text-white'
                      : 'bg-white text-gray-600 hover:bg-gray-100 border border-gray-200'
                  }`}
                >
                  {child.displayName}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Specialvarer (Netvarer) */}
        {!isCatalogMode && specialVarer.length > 0 && (
          <>
            <button
              onClick={() => setShowSpecial(v => !v)}
              className="flex w-full items-center justify-between bg-teal-50 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-teal-700 border-b border-teal-100"
            >
              <span className="flex items-center gap-1.5"><Fish size={12} /> Dagens specialvarer ({specialVarer.length})</span>
              {showSpecial ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
            </button>
            {showSpecial && (
              <div className="divide-y divide-teal-50">
                {specialVarer.map(vare => {
                  const fmt2 = new Intl.NumberFormat('da-DK', { style: 'currency', currency: 'DKK', minimumFractionDigits: 2 })
                  const remaining = vare.availableKg - vare.reservedKg
                  const myRes = specialReservations.get(vare.id)
                  const isReserving = specialReserving === vare.id
                  return (
                    <div key={vare.id} className="px-3 py-3 bg-teal-50/40">
                      <div className="flex items-start gap-3">
                        {/* Kassefoto */}
                        {vare.boxEntryNo ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={`/api/foto/thumb?entryNo=${vare.boxEntryNo}`}
                            alt=""
                            className="shrink-0 h-14 w-14 rounded-lg object-cover border border-teal-200 bg-teal-100"
                            onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
                          />
                        ) : (
                          <div className="shrink-0 h-14 w-14 rounded-lg bg-teal-100 flex items-center justify-center">
                            <Fish size={22} className="text-teal-400" />
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-gray-900 truncate">{vare.itemName}</p>
                          <p className="text-[11px] text-gray-400 font-mono">{vare.bcItemNumber}</p>
                          {vare.note && (
                            <p className="mt-0.5 text-xs text-teal-700 italic">{vare.note}</p>
                          )}
                          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-gray-600">
                            <span className="rounded-full bg-teal-100 px-2 py-0.5 font-medium text-teal-800">
                              {remaining.toFixed(1)} kg tilbage
                            </span>
                            {vare.pricePerKg && (
                              <span className="font-semibold text-gray-700">{fmt2.format(vare.pricePerKg)}/kg</span>
                            )}
                          </div>
                          {myRes ? (
                            <div className="mt-2 flex items-center gap-2">
                              <span className="rounded-full bg-teal-600 text-white px-3 py-1 text-xs font-semibold">
                                Reserveret: {myRes.kg} kg
                              </span>
                              <button
                                onClick={() => handleCancelReservation(vare)}
                                className="flex items-center gap-1 rounded-full border border-red-200 px-2 py-0.5 text-xs text-red-500 hover:bg-red-50"
                              >
                                <X size={10} /> Fortryd
                              </button>
                            </div>
                          ) : remaining > 0 ? (
                            <div className="mt-2">
                              <button
                                onClick={() => handleReserver(vare)}
                                disabled={isReserving}
                                className="rounded-lg bg-teal-600 px-4 py-2 text-xs font-semibold text-white hover:bg-teal-700 disabled:opacity-50 transition"
                              >
                                {isReserving ? '…' : `Reservér hele partiet (${remaining.toFixed(1)} kg)`}
                              </button>
                            </div>
                          ) : (
                            <p className="mt-2 text-xs text-red-500 font-medium">Udsolgt</p>
                          )}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </>
        )}

        {/* Promos */}
        {!isCatalogMode && promotions.length > 0 && (
          <>
            <button
              onClick={() => setShowPromos(v => !v)}
              className="flex w-full items-center justify-between bg-orange-50 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-orange-700 border-b border-orange-100"
            >
              <span className="flex items-center gap-1.5"><Flame size={12} /> Dagens anbefalinger ({promotions.length})</span>
              {showPromos ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
            </button>
            {showPromos && (
              <div className="divide-y divide-gray-100/80">
                {promotions.map(({ item, note }) => (
                  <OrderRow
                    key={`promo-${item.number}`}
                    item={item} quantity={getQty(item.number)}
                    onQty={qty => setQty(item, qty)} priceTiers={priceTiers}
                    isPromo promoNote={note}
                    isFavorite={favSet.has(item.number)} onToggleFav={() => toggleFavorite(item)}
                    selectedUom={lineUoms.get(item.number)} onUomChange={code => setLineUom(item, code)}
                    onOpenDetail={() => setDetailItem(item)}
                  />
                ))}
              </div>
            )}
          </>
        )}

        {/* Søg og tilføj vare — over favoritter */}
        {!isCatalogMode && (
          <div className="border-b border-dashed border-gray-200">
            <button
              onClick={() => setShowSearch(true)}
              className="flex w-full items-center gap-2 px-4 py-3 text-sm font-medium text-blue-600 hover:bg-blue-50 transition"
            >
              <Search size={15} />
              Søg og tilføj vare
            </button>
          </div>
        )}

        {/* Favoritter & Venmark-anbefalede — flettet og sorteret efter varenummer */}
        {!isCatalogMode && mergedFavVenmark.length > 0 && (
          <>
            <div className="px-3 py-1 bg-gray-50 border-y border-gray-100 text-[10px] font-semibold uppercase tracking-wide text-gray-400 flex items-center gap-1">
              <Heart size={10} className="text-red-300" /> Favoritter &amp; anbefalede
            </div>
            <div className="divide-y divide-gray-100/80">
              {mergedFavVenmark.map(({ item, isVenmark, vNote }) => (
                <OrderRow
                  key={`favvenmark-${item.number}`}
                  item={item} quantity={getQty(item.number)}
                  onQty={qty => setQty(item, qty)} priceTiers={priceTiers}
                  isVenmark={isVenmark} venmarkNote={vNote}
                  isFavorite={favSet.has(item.number)} onToggleFav={() => toggleFavorite(item)}
                  selectedUom={lineUoms.get(item.number)} onUomChange={code => setLineUom(item, code)}
                  onOpenDetail={() => setDetailItem(item)}
                  unavailableLabel={deliveryDate && !isItemAvailable(item.number, deliveryDate) ? cutoffLabel(item.number) : ''}
                />
              ))}
            </div>
          </>
        )}

        {/* Faste ordrelinjer */}
        {!isCatalogMode && standingOrders.length > 0 && (
          <>
            <button
              onClick={() => setShowStanding(v => !v)}
              className="flex w-full items-center justify-between bg-purple-50 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-purple-700 border-b border-purple-100"
            >
              <span className="flex items-center gap-1.5">
                <RefreshCw size={12} />
                Faste ordrer — {weekdayName} ({standingOrders.length})
              </span>
              {showStanding ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
            </button>
            {showStanding && (
              <div className="divide-y divide-gray-100/80">
                {standingOrders.map((s) => {
                  const weekdayQty = getStandingQty(s, selectedWeekday)
                  const currentQty = getQty(s.item.number)
                  const isEdited   = manuallyEdited.current.has(s.item.number) && currentQty !== weekdayQty
                  return (
                    <div key={`standing-${s.item.number}`} className="relative">
                      {isEdited && (
                        <span className="absolute right-12 top-1/2 -translate-y-1/2 text-[10px] text-purple-400 italic z-10">
                          ændret
                        </span>
                      )}
                      <OrderRow
                        item={s.item} quantity={currentQty}
                        onQty={qty => setQty(s.item, qty)} priceTiers={priceTiers}
                        isFavorite={favSet.has(s.item.number)} onToggleFav={() => toggleFavorite(s.item)}
                        selectedUom={lineUoms.get(s.item.number) ?? s.unitOfMeasure} onUomChange={code => setLineUom(s.item, code)}
                        onOpenDetail={() => setDetailItem(s.item)}
                      />
                    </div>
                  )
                })}
              </div>
            )}
          </>
        )}

        {/* Katalog-varer */}
        {isCatalogMode && (
          <>
            <div className="px-3 py-1.5 bg-blue-50 border-y border-blue-100 text-[10px] font-semibold uppercase tracking-wide text-blue-500 flex items-center gap-1">
              {catalogPath.map((code, i) => {
                const node = i === 0
                  ? findCatNode(l0Cats, code)
                  : i === 1
                  ? findCatNode(l1Node?.children ?? [], code)
                  : findCatNode(l2Node?.children ?? [], code)
                return <span key={code}>{i > 0 && <span className="mx-1 opacity-50">›</span>}{node?.displayName ?? code}</span>
              })}
              <span className="opacity-50 ml-1">— alle varer</span>
            </div>
            {categoryLoading && (
              <div className="px-4 py-6 text-center text-sm text-gray-400">Henter varer…</div>
            )}
            {!categoryLoading && categoryItems.length === 0 && (
              <div className="px-4 py-6 text-center text-sm text-gray-400">Ingen priser på varer i denne kategori</div>
            )}
            {!categoryLoading && categoryItems.length > 0 && (
              <div className="divide-y divide-gray-100/80">
                {categoryItems.map(item => (
                  <OrderRow
                    key={`cat-${item.number}`}
                    item={item} quantity={getQty(item.number)}
                    onQty={qty => setQty(item, qty)}
                    priceTiers={[...priceTiers, ...categoryPriceTiers]}
                    isFavorite={favSet.has(item.number)} onToggleFav={() => toggleFavorite(item)}
                    selectedUom={lineUoms.get(item.number)} onUomChange={code => setLineUom(item, code)}
                    onOpenDetail={() => setDetailItem(item)}
                    unavailableLabel={deliveryDate && !isItemAvailable(item.number, deliveryDate) ? cutoffLabel(item.number) : ''}
                  />
                ))}
              </div>
            )}
          </>
        )}

        {/* Søgte varer */}
        {searchedLines.length > 0 && (
          <>
            <div className="px-3 py-1 bg-gray-50 border-y border-gray-100 text-[10px] font-semibold uppercase tracking-wide text-gray-400 flex items-center gap-1">
              <Search size={10} /> Tilføjede varer
            </div>
            <div className="divide-y divide-gray-100/80">
              {searchedLines.map(({ item, quantity }) => (
                <OrderRow
                  key={`search-${item.number}`}
                  item={item} quantity={quantity}
                  onQty={qty => setQty(item, qty)} priceTiers={priceTiers}
                  isFavorite={favSet.has(item.number)} onToggleFav={() => toggleFavorite(item)}
                  selectedUom={lineUoms.get(item.number)} onUomChange={code => setLineUom(item, code)}
                  onOpenDetail={() => setDetailItem(item)}
                />
              ))}
            </div>
          </>
        )}

        {!isCatalogMode && specialVarer.length === 0 && promotions.length === 0 && favorites.length === 0 && venmarkItems.length === 0 && standingOrders.length === 0 && searchedLines.length === 0 && (
          <div className="px-4 py-10 text-center text-sm text-gray-400">
            Ingen favoritter endnu — brug søgning nedenfor
          </div>
        )}

      </div>

      {/* PO-nummer */}
      <div className="rounded-xl bg-white p-4 ring-1 ring-gray-200">
        <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-gray-500">
          PO-nummer / Indkøbsordre{requirePoNumber ? ' *' : ' (valgfri)'}
        </label>
        <input
          type="text"
          value={poNumber}
          onChange={e => setPoNumber(e.target.value)}
          placeholder={requirePoNumber ? 'Påkrævet — angiv PO-nummer' : 'f.eks. PO-2024-1234'}
          className={`w-full rounded-lg border px-3 py-2 text-sm focus:outline-none ${
            requirePoNumber && !poNumber.trim()
              ? 'border-orange-400 bg-orange-50 focus:border-orange-500'
              : 'border-gray-300 focus:border-blue-400'
          }`}
        />
        {requirePoNumber && !poNumber.trim() && (
          <p className="mt-1.5 text-xs text-orange-600">
            ⚠️ Din konto kræver et PO-nummer. Du kan indsende ordren uden, men husk at tilføje det bagefter.
          </p>
        )}
      </div>

      {/* Note + chauffør-besked */}
      <div className="rounded-xl bg-white p-4 ring-1 ring-gray-200 space-y-3">
        <div>
          <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-gray-500">
            Bemærkning (valgfri)
          </label>
          <textarea
            rows={2} value={notes} onChange={e => setNotes(e.target.value)}
            placeholder="Særlige ønsker, leveringstidspunkt m.m."
            className="w-full resize-none rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">
            Ekstra besked til chauffør (valgfri)
          </label>
          <p className="text-[11px] text-gray-400 mb-1.5">Engangs-instruks pr. levering — chaufføren bekræfter denne ved ankomst</p>
          <textarea
            rows={2} value={driverNote} onChange={e => setDriverNote(e.target.value)}
            placeholder="f.eks. Aflever til Jens i dag, ikke i køleskuret"
            className="w-full resize-none rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none"
          />
          {driverNote.trim() && (
            <p className="mt-1 text-[11px] text-blue-500 flex items-center gap-1">
              🔔 Chaufføren vil blive bedt om at bekræfte denne besked ved levering
            </p>
          )}
        </div>
      </div>

      {/* Sammenfatning + indsend */}
      <div className="rounded-xl bg-white p-4 ring-1 ring-gray-200">
        {totalLines > 0 ? (
          <div className="mb-3 space-y-1 text-sm text-gray-700">
            <div className="flex justify-between">
              <span>Antal linjer</span>
              <span className="font-semibold">{totalLines}</span>
            </div>
            {totalAmount > 0 && (
              <div className="flex justify-between">
                <span>Ca. beløb</span>
                <span className="font-semibold">{fmt.format(totalAmount)}</span>
              </div>
            )}
            <div className="flex justify-between text-gray-500">
              <span>Levering</span>
              <span>{formatLongDate(deliveryDate)}</span>
            </div>
          </div>
        ) : (
          <p className="mb-3 text-sm text-gray-400">Ingen varer valgt endnu</p>
        )}

        {error && <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

        <button
          onClick={handleSubmit}
          disabled={totalLines === 0 || submitting || pastDeadline}
          className="w-full rounded-xl bg-blue-600 py-3.5 text-base font-bold text-white shadow-sm transition hover:bg-blue-700 active:scale-[0.98] disabled:opacity-40"
        >
          {submitting ? 'Sender…'
            : pastDeadline ? 'Deadline passeret for denne dag'
            : totalLines === 0 ? 'Tilføj varer for at bestille'
            : `Indsend bestilling (${totalLines} ${totalLines === 1 ? 'linje' : 'linjer'})`}
        </button>
      </div>

      {/* Søgning/katalog modal */}
      {showSearch && (
        <ItemSearchModal
          onAddItems={addSearchedItems}
          onClose={() => setShowSearch(false)}
          favNos={favSet}
          onToggleFav={toggleFavorite}
        />
      )}

      {/* Vare-detalje modal */}
      {detailItem && (
        <ItemDetailModal item={detailItem} onClose={() => setDetailItem(null)} />
      )}
    </div>
  )
}
