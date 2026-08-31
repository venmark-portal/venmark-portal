'use client'

import { useState } from 'react'
import { CheckCircle2, Clock, XCircle, PackageCheck, Package } from 'lucide-react'

// Tal uden valuta-symbol/enhed (kolonne-overskriften siger hvad det er). Dansk komma-decimal.
const num = new Intl.NumberFormat('da-DK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const qtyFmt = new Intl.NumberFormat('da-DK', { maximumFractionDigits: 3 })

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
}

const LINE_STATUS = {
  Godkendt: { icon: <CheckCircle2 size={14} className="text-green-500" />, label: 'Godkendt' },
  Afventer: { icon: <Clock        size={14} className="text-amber-400" />, label: 'Afventer' },
  Afvist:   { icon: <XCircle      size={14} className="text-red-500"   />, label: 'Afvist'   },
}

export default function OrderLineStatus({
  itemNumber, itemName, quantity, uom, unitPrice, portalLineStatus, portalCustomerNote,
  packedBy = '', packedQty = 0,
}: Props) {
  const [open, setOpen]     = useState(false)
  const [showFull, setFull] = useState(false)

  const status   = LINE_STATUS[portalLineStatus ?? 'Afventer']
  const hasNote  = !!portalCustomerNote
  const isAfvist = portalLineStatus === 'Afvist'
  const isPacked = !!packedBy
  const longName = itemName.length > 30
  const shownName = showFull || !longName ? itemName : itemName.slice(0, 30) + '…'

  return (
    <div className="border-b border-gray-50 last:border-0">
      <div className={`${LINE_GRID_CLS} px-4 py-1.5 text-sm`} style={{ gridTemplateColumns: LINE_COLS }}>
        {/* Status-ikon */}
        <span title={status.label}>{status.icon}</span>

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
              title="Vis bemærkning"
            >
              B
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
            <span className="inline-flex items-center gap-1 rounded-full bg-green-50 px-1.5 py-0.5 text-[10px] font-medium text-green-700" title={`Pakket af ${packedBy}${packedQty ? ` (${qtyFmt.format(packedQty)} ${uom})` : ''}`}>
              <PackageCheck size={10} />{packedBy}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-500" title="Ikke pakket endnu">
              <Package size={10} />Ikke pakket
            </span>
          )}
        </span>
      </div>

      {/* Bemærkning — folder ud ved klik på B */}
      {open && hasNote && (
        <div
          className={`mx-4 mb-2 rounded-lg px-3 py-2 text-xs cursor-pointer ${
            isAfvist ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-800'
          }`}
          onClick={() => setOpen(false)}
        >
          <span className="font-medium">{isAfvist ? 'Ikke godkendt: ' : 'Bemærkning: '}</span>
          {portalCustomerNote}
        </div>
      )}
    </div>
  )
}
