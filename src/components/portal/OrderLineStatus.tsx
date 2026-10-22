'use client'

import { useState } from 'react'
import { CheckCircle2, Clock, XCircle, PackageCheck, Package, Anchor, MapPin } from 'lucide-react'
import { useT, useLocale } from '@/lib/i18n/portal/LangProvider'
import { ordrerDict } from '@/lib/i18n/portal/dict/ordrer'

// Tal uden valuta-symbol/enhed (kolonne-overskriften siger hvad det er). Decimaler efter portalsproget.

// FÆLLES kolonne-skabelon — bruges af BÅDE overskriften (i ordre-siden) og hver linje, så
// kolonnerne flugter. Som inline gridTemplateColumns (ikke Tailwind arbitrary value) fordi
// `minmax(0,1fr)`-kommaet ellers gav inkonsistent klasse-generering på tværs af filer.
export const LINE_COLS = '18px 56px minmax(0,1fr) 120px 84px 92px 110px'
export const LINE_GRID_CLS = 'grid gap-x-2 items-center'

interface Props {
  itemNumber:         string
  itemName:           string
  quantity:           number
  uom:                string
  unitPrice:          number
  portalLineStatus:   'Afventer' | 'Godkendt' | 'Afvist' | null
  portalCustomerNote: string | null
  packedBy?:          string
  packedQty?:         number
  gearType?:          string
  catchArea?:         string
}

const LINE_STATUS = {
  Godkendt: { icon: <CheckCircle2 size={14} className="text-green-500" />, label: 'stGodkendt' },
  Afventer: { icon: <Clock        size={14} className="text-amber-400" />, label: 'stAfventer' },
  Afvist:   { icon: <XCircle      size={14} className="text-red-500"   />, label: 'stAfvist'   },
} as const

export default function OrderLineStatus({
  itemNumber, itemName, quantity, uom, unitPrice, portalLineStatus, portalCustomerNote,
  packedBy = '', packedQty = 0, gearType = '', catchArea = '',
}: Props) {
  const t      = useT(ordrerDict)
  const locale = useLocale()
  const num    = new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const qtyFmt = new Intl.NumberFormat(locale, { maximumFractionDigits: 3 })
  const [open, setOpen]     = useState(false)
  const [showFull, setFull] = useState(false)

  const status   = LINE_STATUS[portalLineStatus ?? 'Afventer']
  const hasNote  = !!portalCustomerNote
  const isAfvist = portalLineStatus === 'Afvist'
  const isPacked = !!packedBy
  const hasTrace = !!(gearType || catchArea)
  const longName = itemName.length > 30
  const shownName = showFull || !longName ? itemName : itemName.slice(0, 30) + '…'

  return (
    <div className="border-b border-gray-50 last:border-0">
      <div className={`${LINE_GRID_CLS} px-4 py-1.5 text-sm`} style={{ display: 'grid', gridTemplateColumns: LINE_COLS }}>
        {/* Status-ikon */}
        <span title={t(status.label)}>{status.icon}</span>

        {/* Varenr */}
        <span className="font-mono text-xs text-gray-400 truncate">{itemNumber}</span>

        {/* Beskrivelse (skåret til 30 tegn, klik/hover = fuld) */}
        <div className="min-w-0 flex items-center gap-1">
          <span
            className={`truncate text-gray-800 ${longName ? 'cursor-pointer' : ''}`}
            title={itemName}
            onClick={() => longName && setFull(v => !v)}
          >
            {shownName}
          </span>
          {hasNote && (
            <button
              onClick={() => setOpen(v => !v)}
              className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-amber-400 text-white text-[9px] font-bold leading-none shrink-0 hover:bg-amber-500 transition-colors"
              title={t('visBemaerkning')}
            >
              {t('bemaerkningBogstav')}
            </button>
          )}
        </div>

        {/* Antal (med enhed) */}
        <span className="text-right tabular-nums text-gray-700">{qtyFmt.format(quantity)} {uom}</span>

        {/* Pris pr. enhed (uden à/kr) */}
        <span className="text-right tabular-nums text-gray-500">{unitPrice > 0 ? num.format(unitPrice) : ''}</span>

        {/* Beløb */}
        <span className="text-right tabular-nums font-medium text-gray-700">{unitPrice > 0 ? num.format(quantity * unitPrice) : ''}</span>

        {/* Pakket af / ikke pakket */}
        <span className="justify-self-start">
          {isPacked ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-green-50 px-1.5 py-0.5 text-[10px] font-medium text-green-700" title={`${t('pakketAf', { navn: packedBy })}${packedQty ? ` (${qtyFmt.format(packedQty)} ${uom})` : ''}`}>
              <PackageCheck size={10} />{packedBy}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-500" title={t('ikkePakketEndnu')}>
              <Package size={10} />{t('ikkePakket')}
            </span>
          )}
        </span>
      </div>

      {/* Sporbarhed — fangstredskab + område på pakkede linjer (indrykket under beskrivelsen) */}
      {hasTrace && (
        <div className="pb-1.5 -mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-gray-500" style={{ paddingLeft: 90 }}>
          {gearType && (
            <span className="inline-flex items-center gap-1" title={t('fangstredskab')}>
              <Anchor size={11} className="text-sky-500 shrink-0" />{gearType}
            </span>
          )}
          {catchArea && (
            <span className="inline-flex items-center gap-1" title={t('fangstomraade')}>
              <MapPin size={11} className="text-sky-500 shrink-0" />{catchArea}
            </span>
          )}
        </div>
      )}

      {/* Bemærkning — folder ud ved klik på B */}
      {open && hasNote && (
        <div
          className={`mx-4 mb-2 rounded-lg px-3 py-2 text-xs cursor-pointer ${
            isAfvist ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-800'
          }`}
          onClick={() => setOpen(false)}
        >
          <span className="font-medium">{isAfvist ? t('ikkeGodkendt') : t('bemaerkning')}</span>
          {portalCustomerNote}
        </div>
      )}
    </div>
  )
}
