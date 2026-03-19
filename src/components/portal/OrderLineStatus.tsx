'use client'

import { useState } from 'react'
import { CheckCircle2, Clock, XCircle } from 'lucide-react'

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
}

const LINE_STATUS = {
  Godkendt: { icon: <CheckCircle2 size={14} className="text-green-500" />, label: 'Godkendt' },
  Afventer: { icon: <Clock        size={14} className="text-amber-400" />, label: 'Afventer' },
  Afvist:   { icon: <XCircle      size={14} className="text-red-500"   />, label: 'Afvist'   },
}

export default function OrderLineStatus({
  itemNumber, itemName, quantity, uom, unitPrice, portalLineStatus, portalCustomerNote,
}: Props) {
  const [open, setOpen] = useState(false)

  const status  = LINE_STATUS[portalLineStatus ?? 'Afventer']
  const hasNote = !!portalCustomerNote
  const isAfvist = portalLineStatus === 'Afvist'

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
        </div>

        {/* Antal + pris */}
        <div className="ml-4 shrink-0 tabular-nums text-gray-500">
          {quantity} {uom}
          {unitPrice > 0 && (
            <span className="ml-2 text-gray-400">{fmt.format(quantity * unitPrice)}</span>
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
