'use client'
export const dynamic = 'force-dynamic'

import { useState, useEffect, useCallback } from 'react'
import { useSession } from 'next-auth/react'
import { Package, CheckCircle2, ChevronDown, ChevronUp, Truck } from 'lucide-react'

interface PakLine {
  id: string
  lineNo: number
  itemNo: string
  description: string
  quantity: number
  shipQty: number
  uom: string
  packedBy: string
}

interface Customer {
  orderNo: string
  customerName: string
  address: string
  vehicle: string
  packed: boolean
  lines: PakLine[]
}

export default function ChauffeurPakPage() {
  const { data: session } = useSession()
  const [customers,  setCustomers]  = useState<Customer[]>([])
  const [bcDriverCode, setBcDriverCode] = useState('')
  const [loading,    setLoading]    = useState(true)
  const [allVehicles, setAllVehicles] = useState(false)
  const [noRoute,    setNoRoute]    = useState(false)
  const [expanded,   setExpanded]   = useState<Set<string>>(new Set())
  const [saving,     setSaving]     = useState<Set<string>>(new Set())
  const [editQty,    setEditQty]    = useState<Record<string, number>>({})

  const today = (() => {
    const now = new Date()
    const cphToday = now.toLocaleDateString('sv-SE', { timeZone: 'Europe/Copenhagen' })
    const cphHour  = parseInt(now.toLocaleString('en-US', { timeZone: 'Europe/Copenhagen', hour: '2-digit', hour12: false }))
    if (cphHour >= 15) {
      const d = new Date(cphToday + 'T12:00:00')
      do { d.setDate(d.getDate() + 1) } while (d.getDay() === 0 || d.getDay() === 6)
      return d.toISOString().slice(0, 10)
    }
    return cphToday
  })()

  const load = useCallback(async () => {
    setLoading(true)
    const res  = await fetch(`/api/chauffeur/pak?date=${today}&alle=${allVehicles ? '1' : '0'}`)
    const data = await res.json()
    setCustomers(data.customers ?? [])
    setBcDriverCode(data.bcDriverCode ?? '')
    setNoRoute(!!data.noRoute)
    setLoading(false)
  }, [today, allVehicles])

  useEffect(() => { load() }, [load])

  function toggleExpand(orderNo: string) {
    setExpanded(prev => {
      const n = new Set(prev)
      n.has(orderNo) ? n.delete(orderNo) : n.add(orderNo)
      return n
    })
  }

  async function godkend(customer: Customer) {
    setSaving(prev => new Set(prev).add(customer.orderNo))
    const lines = customer.lines.map(l => ({
      id:      l.id,
      shipQty: editQty[l.id] ?? l.shipQty,
    }))
    await fetch('/api/chauffeur/pak', {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ lines, bcDriverCode }),
    })
    // Opdater lokalt
    setCustomers(prev => prev.map(c =>
      c.orderNo !== customer.orderNo ? c : {
        ...c,
        packed: true,
        lines:  c.lines.map(l => ({ ...l, packedBy: bcDriverCode, shipQty: editQty[l.id] ?? l.shipQty })),
      }
    ))
    setSaving(prev => { const n = new Set(prev); n.delete(customer.orderNo); return n })
    setExpanded(prev => { const n = new Set(prev); n.delete(customer.orderNo); return n })
  }

  const packed   = customers.filter(c => c.packed).length
  const total    = customers.length

  if (loading) return (
    <div className="flex min-h-screen items-center justify-center text-sm text-gray-400">
      Henter pakkeliste…
    </div>
  )

  return (
    <div className="mx-auto max-w-lg px-4 py-6 space-y-4">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Package size={20} className="text-blue-600" />
            <h1 className="text-lg font-bold text-gray-900">Pak KØB*</h1>
          </div>
          <p className="text-sm text-gray-500 mt-0.5">
            {session?.user?.name} · {packed}/{total} pakket
          </p>
        </div>
        <button
          onClick={() => setAllVehicles(v => !v)}
          className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
            allVehicles
              ? 'border-blue-400 bg-blue-50 text-blue-700'
              : 'border-gray-200 text-gray-500 hover:bg-gray-50'
          }`}>
          <Truck size={13} /> {allVehicles ? 'Alle biler' : 'Min bil'}
        </button>
      </div>

      {/* Fremgang */}
      {total > 0 && (
        <div className="rounded-xl bg-white p-4 ring-1 ring-gray-200">
          <div className="mb-2 flex justify-between text-xs text-gray-500">
            <span>Fremgang</span><span>{packed} / {total}</span>
          </div>
          <div className="h-2.5 w-full rounded-full bg-gray-100">
            <div className="h-2.5 rounded-full bg-green-500 transition-all"
              style={{ width: total > 0 ? `${(packed / total) * 100}%` : '0%' }} />
          </div>
        </div>
      )}

      {noRoute && (
        <div className="rounded-xl bg-amber-50 p-4 ring-1 ring-amber-200 text-sm text-amber-800">
          Ingen rute planlagt for i dag — gem ruten i admin-siden for at se din bil.
        </div>
      )}

      {!loading && total === 0 && !noRoute && (
        <div className="rounded-xl bg-white p-8 text-center ring-1 ring-gray-200 text-sm text-gray-400">
          Ingen KØB*-ordrer at pakke i dag
        </div>
      )}

      {/* Kundekort */}
      {customers.map(c => {
        const isExpanded = expanded.has(c.orderNo)
        const isSaving   = saving.has(c.orderNo)

        return (
          <div key={c.orderNo}
            className={`rounded-2xl ring-1 transition-colors ${
              c.packed ? 'bg-green-50 ring-green-200' : 'bg-red-50 ring-red-300'
            }`}>

            {/* Kort-header */}
            <button
              onClick={() => !c.packed && toggleExpand(c.orderNo)}
              className="w-full flex items-start gap-3 p-4 text-left">
              <div className={`mt-0.5 rounded-full p-1.5 ${c.packed ? 'bg-green-100' : 'bg-red-100'}`}>
                {c.packed
                  ? <CheckCircle2 size={18} className="text-green-600" />
                  : <Package size={18} className="text-red-500" />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-sm text-gray-900">{c.customerName}</div>
                {c.address && <div className="text-xs text-gray-500 mt-0.5">{c.address}</div>}
                <div className="mt-1 flex items-center gap-2 text-xs text-gray-400">
                  <span className="font-mono">{c.orderNo}</span>
                  {allVehicles && <span>· {c.vehicle}</span>}
                  <span>· {c.lines.length} linjer</span>
                  {c.packed && c.lines[0]?.packedBy && (
                    <span className="text-green-600 font-medium">· {c.lines[0].packedBy}</span>
                  )}
                </div>
              </div>
              {!c.packed && (
                isExpanded
                  ? <ChevronUp size={16} className="shrink-0 text-gray-400 mt-1" />
                  : <ChevronDown size={16} className="shrink-0 text-gray-400 mt-1" />
              )}
            </button>

            {/* Linjer */}
            {isExpanded && !c.packed && (
              <div className="border-t border-red-200 px-4 pb-4 pt-3 space-y-3">
                <div className="space-y-2">
                  {c.lines.map(l => (
                    <div key={l.id} className="flex items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-gray-900 truncate">{l.description}</div>
                        <div className="text-xs text-gray-400">{l.itemNo} · Bestilt: {l.quantity} {l.uom}</div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <span className="text-xs text-gray-500">Pakkes:</span>
                        <input
                          type="number"
                          min={0}
                          defaultValue={l.shipQty}
                          onChange={e => setEditQty(prev => ({ ...prev, [l.id]: Number(e.target.value) }))}
                          className="w-16 rounded-lg border border-gray-200 px-2 py-1.5 text-sm text-center focus:border-blue-400 focus:outline-none tabular-nums"
                        />
                        <span className="text-xs text-gray-400">{l.uom}</span>
                      </div>
                    </div>
                  ))}
                </div>

                <button
                  onClick={() => godkend(c)}
                  disabled={isSaving}
                  className="w-full flex items-center justify-center gap-2 rounded-xl bg-green-600 py-3 text-sm font-bold text-white hover:bg-green-700 disabled:opacity-50">
                  <CheckCircle2 size={16} />
                  {isSaving ? 'Gemmer…' : 'Godkend pakning'}
                </button>
              </div>
            )}
          </div>
        )
      })}

      {/* Alle pakket */}
      {total > 0 && packed === total && (
        <div className="rounded-2xl bg-green-600 p-6 text-center text-white">
          <CheckCircle2 size={32} className="mx-auto mb-2" />
          <div className="font-bold text-lg">Alt pakket!</div>
          <div className="text-sm opacity-80 mt-1">Klar til levering</div>
        </div>
      )}
    </div>
  )
}
