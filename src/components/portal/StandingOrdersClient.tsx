'use client'

import { useState, useTransition } from 'react'
import { Plus, Trash2, Save, Send, Loader2, CheckCircle2, AlertCircle, RefreshCw } from 'lucide-react'
import ItemSearchModal from './ItemSearchModal'
import { saveStandingOrderTemplate, orderFromTemplate } from '@/app/portal/(protected)/fast/actions'
import type { BCItem } from '@/lib/businesscentral'

type Line = { bcItemNumber: string; itemName: string; quantity: number; uom: string }

type WeekdayInfo = {
  weekday:        number
  deliveryLabel:  string
  deadlinePassed: boolean
  lines:          Line[]
}

const DAY_NAMES = ['', 'Mandag', 'Tirsdag', 'Onsdag', 'Torsdag', 'Fredag']

type CardState = {
  lines:        Line[]
  dirty:        boolean
  saving:       boolean
  ordering:     boolean
  saveMsg:      string | null  // '' = cleared
  orderMsg:     string | null
  orderOk:      boolean
  searchOpen:   boolean
}

export default function StandingOrdersClient({ weekdays }: { weekdays: WeekdayInfo[] }) {
  const [cards, setCards] = useState<Record<number, CardState>>(() => {
    const init: Record<number, CardState> = {}
    for (const wd of weekdays) {
      init[wd.weekday] = {
        lines:      wd.lines,
        dirty:      false,
        saving:     false,
        ordering:   false,
        saveMsg:    null,
        orderMsg:   null,
        orderOk:    false,
        searchOpen: false,
      }
    }
    return init
  })

  function update(weekday: number, patch: Partial<CardState>) {
    setCards((prev) => ({ ...prev, [weekday]: { ...prev[weekday], ...patch } }))
  }

  // ── Tilføj vare fra søgemodal ────────────────────────────────────────────────
  function addItem(weekday: number, item: BCItem & { unitPrice: number }) {
    const c = cards[weekday]
    if (c.lines.some((l) => l.bcItemNumber === item.number)) {
      update(weekday, { searchOpen: false })
      return
    }
    update(weekday, {
      lines:      [...c.lines, { bcItemNumber: item.number, itemName: item.displayName, quantity: 1, uom: item.baseUnitOfMeasureCode }],
      dirty:      true,
      searchOpen: false,
    })
  }

  // ── Ændr antal ───────────────────────────────────────────────────────────────
  function changeQty(weekday: number, idx: number, val: number) {
    const lines = cards[weekday].lines.map((l, i) => i === idx ? { ...l, quantity: Math.max(0.1, val) } : l)
    update(weekday, { lines, dirty: true })
  }

  // ── Fjern linje ──────────────────────────────────────────────────────────────
  function removeLine(weekday: number, idx: number) {
    const lines = cards[weekday].lines.filter((_, i) => i !== idx)
    update(weekday, { lines, dirty: true })
  }

  // ── Gem skabelon ─────────────────────────────────────────────────────────────
  async function handleSave(weekday: number) {
    update(weekday, { saving: true, saveMsg: null })
    try {
      await saveStandingOrderTemplate(weekday, cards[weekday].lines)
      update(weekday, { saving: false, dirty: false, saveMsg: 'Gemt ✓' })
      setTimeout(() => update(weekday, { saveMsg: null }), 3000)
    } catch (err) {
      update(weekday, { saving: false, saveMsg: `Fejl: ${err instanceof Error ? err.message : 'Prøv igen'}` })
    }
  }

  // ── Bestil fra skabelon ──────────────────────────────────────────────────────
  async function handleOrder(weekday: number) {
    update(weekday, { ordering: true, orderMsg: null, orderOk: false })
    try {
      await orderFromTemplate(weekday)
      update(weekday, { ordering: false, orderOk: true, orderMsg: 'Ordre oprettet! ✓' })
      setTimeout(() => update(weekday, { orderMsg: null, orderOk: false }), 5000)
    } catch (err) {
      update(weekday, { ordering: false, orderOk: false, orderMsg: err instanceof Error ? err.message : 'Fejl' })
    }
  }

  const fmtQty = (n: number) =>
    Number.isInteger(n) ? String(n) : n.toFixed(1)

  return (
    <div className="space-y-4">
      {weekdays.map((wd) => {
        const c = cards[wd.weekday]
        const hasLines = c.lines.length > 0

        return (
          <div key={wd.weekday} className="overflow-hidden rounded-xl bg-white ring-1 ring-gray-200">
            {/* ── Korthovede ── */}
            <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
              <div>
                <h2 className="font-semibold text-gray-900">{DAY_NAMES[wd.weekday]}</h2>
                <p className="text-xs text-gray-400">Næste: {wd.deliveryLabel}</p>
              </div>

              <button
                onClick={() => handleOrder(wd.weekday)}
                disabled={!hasLines || c.dirty || c.ordering || wd.deadlinePassed}
                title={
                  c.dirty         ? 'Gem skabelon først'          :
                  wd.deadlinePassed ? 'Deadline passeret denne uge' :
                  !hasLines       ? 'Ingen varer i skabelonen'     : undefined
                }
                className="flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-40"
              >
                {c.ordering
                  ? <Loader2 size={13} className="animate-spin" />
                  : <Send size={13} />}
                Bestil næste {DAY_NAMES[wd.weekday].toLowerCase()}
              </button>
            </div>

            {/* ── Ordrebeskeder ── */}
            {c.orderMsg && (
              <div className={`flex items-center gap-2 px-4 py-2 text-xs font-medium ${
                c.orderOk ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
              }`}>
                {c.orderOk ? <CheckCircle2 size={13} /> : <AlertCircle size={13} />}
                {c.orderMsg}
                {c.orderOk && (
                  <a href="/portal/ordrer" className="ml-1 underline">Se mine ordrer</a>
                )}
              </div>
            )}

            {/* ── Vareliste ── */}
            {hasLines ? (
              <div className="divide-y divide-gray-50">
                {c.lines.map((line, idx) => (
                  <div key={line.bcItemNumber} className="flex items-center gap-3 px-4 py-2.5">
                    <div className="flex-1 min-w-0">
                      <div className="truncate text-sm text-gray-900">{line.itemName}</div>
                      <div className="font-mono text-xs text-gray-400">{line.bcItemNumber}</div>
                    </div>
                    {/* Antal-stepper */}
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => changeQty(wd.weekday, idx, line.quantity - (line.uom === 'KG' ? 0.5 : 1))}
                        className="flex h-7 w-7 items-center justify-center rounded border border-gray-200 text-gray-500 hover:bg-gray-50"
                      >−</button>
                      <input
                        type="number"
                        min={0.1}
                        step={line.uom === 'KG' ? 0.5 : 1}
                        value={fmtQty(line.quantity)}
                        onChange={(e) => changeQty(wd.weekday, idx, parseFloat(e.target.value) || 1)}
                        className="w-14 rounded border border-gray-200 px-1 py-0.5 text-center text-sm tabular-nums focus:outline-none focus:ring-1 focus:ring-blue-400"
                      />
                      <button
                        onClick={() => changeQty(wd.weekday, idx, line.quantity + (line.uom === 'KG' ? 0.5 : 1))}
                        className="flex h-7 w-7 items-center justify-center rounded border border-gray-200 text-gray-500 hover:bg-gray-50"
                      >+</button>
                      <span className="w-8 text-xs text-gray-400">{line.uom}</span>
                    </div>
                    <button
                      onClick={() => removeLine(wd.weekday, idx)}
                      className="rounded p-1 text-gray-300 hover:bg-red-50 hover:text-red-500"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="px-4 py-6 text-center text-sm text-gray-400">
                Ingen varer endnu — tilføj varer til skabelonen
              </div>
            )}

            {/* ── Footer: tilføj + gem ── */}
            <div className="flex items-center justify-between border-t border-gray-100 px-4 py-2">
              <button
                onClick={() => update(wd.weekday, { searchOpen: true })}
                className="flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-700"
              >
                <Plus size={15} />
                Tilføj vare
              </button>

              <div className="flex items-center gap-2">
                {c.saveMsg && (
                  <span className={`text-xs ${c.saveMsg.startsWith('Fejl') ? 'text-red-600' : 'text-green-600'}`}>
                    {c.saveMsg}
                  </span>
                )}
                <button
                  onClick={() => handleSave(wd.weekday)}
                  disabled={!c.dirty || c.saving}
                  className="flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40"
                >
                  {c.saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                  Gem skabelon
                </button>
              </div>
            </div>

            {/* ── Søgemodal ── */}
            {c.searchOpen && (
              <ItemSearchModal
                onSelect={(item) => addItem(wd.weekday, item)}
                onClose={() => update(wd.weekday, { searchOpen: false })}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}
