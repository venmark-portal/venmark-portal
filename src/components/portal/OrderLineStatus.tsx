'use client'

import { useState } from 'react'
import { CheckCircle2, Clock, XCircle, PackageCheck, Package } from 'lucide-react'

const fmt = new Intl.NumberFormat('da-DK', {
  style: 'currency', currency: 'DKK', minimumFractionDigits: 2,
})

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
  const [open, setOpen] = useState(false)

  const status  = LINE_STATUS[portalLineStatus ?? 'Afventer']
  const hasNote = !!portalCustomerNote
  const isAfvist = portalLineStatus === 'Afvist'
  const isPacked = !!packedBy

  return (
    <div className="border-b border-gray-50 last:border-0">
      <div className="flex items-center justify-between px-4 py-1.5 text-sm">

        {/* Status + vare-info */}
        <div className="min-w-0 flex-1 flex items-center gap-2">
          <span title={status.label}>{status.icon}</span>
          <span className="font-mono text-xs text-gray-400">{itemNumber}</span>
          <span className="text-gray-800">{itemName}</span>
          {/* Gult B-badge ved bemærkning */}
          {hasNote && (
            <button
              onClick={() => setOpen((v) => !v)}
              className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-amber-400 text-white text-[9px] font-bold leading-none shrink-0 hover:bg-amber-500 transition-colors"
              title="Vis bemærkning"
            >
              B
            </button>
          )}
          {/* Pakket af / ikke pakket */}
          {isPacked ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-green-50 px-1.5 py-0.5 text-[10px] font-medium text-green-700 shrink-0" title={`Pakket af ${packedBy}${packedQty ? ` (${packedQty} ${uom})` : ''}`}>
              <PackageCheck size={10} />Pakket {packedBy}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-500 shrink-0" title="Ikke pakket endnu">
              <Package size={10} />Ikke pakket
            </span>
          )}
        </div>

        {/* Antal · beløb pr. enhed · linjebeløb */}
        <div className="ml-4 shrink-0 tabular-nums text-right">
          <span className="text-gray-700">{quantity} {uom}</span>
          {unitPrice > 0 && (
            <>
              <span className="ml-2 text-gray-400">à {fmt.format(unitPrice)}/{uom}</span>
              <span className="ml-2 font-medium text-gray-600">{fmt.format(quantity * unitPrice)}</span>
            </>
          )}
        </div>
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
