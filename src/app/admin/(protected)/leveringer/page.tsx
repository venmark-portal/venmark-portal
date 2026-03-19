'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Truck, CalendarDays, ArrowRight } from 'lucide-react'

export default function LeveringerPage() {
  const router = useRouter()
  const today = new Date().toISOString().slice(0, 10)
  const [date, setDate] = useState(today)

  function go() {
    router.push(`/admin/leveringer/${date}`)
  }

  // Hurtige valg: i dag + næste 6 hverdage
  const quickDays: { label: string; date: string }[] = []
  const d = new Date()
  for (let i = 0; quickDays.length < 7; i++) {
    const dd = new Date(d)
    dd.setDate(d.getDate() + i)
    const dow = dd.getDay()
    if (dow !== 0 && dow !== 6) {
      const iso = dd.toISOString().slice(0, 10)
      const label = i === 0 ? 'I dag' : i === 1 ? 'I morgen' : dd.toLocaleDateString('da-DK', { weekday: 'short', day: 'numeric', month: 'short' })
      quickDays.push({ label, date: iso })
    }
  }

  return (
    <div className="max-w-xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Truck size={24} className="text-blue-600" /> Leveringsruter
        </h1>
        <p className="text-sm text-gray-500 mt-1">Vælg en bogføringsdato for at planlægge ruten</p>
      </div>

      {/* Hurtige valg */}
      <div className="rounded-xl bg-white p-5 ring-1 ring-gray-200 space-y-4">
        <h2 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
          <CalendarDays size={15} /> Hurtig valg
        </h2>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {quickDays.map(q => (
            <button key={q.date}
              onClick={() => router.push(`/admin/leveringer/${q.date}`)}
              className={`rounded-lg border px-3 py-2.5 text-left text-sm transition hover:border-blue-400 hover:bg-blue-50 ${
                q.date === today ? 'border-blue-400 bg-blue-50 font-semibold text-blue-700' : 'border-gray-200 text-gray-700'
              }`}
            >
              <div className="font-medium">{q.label}</div>
              <div className="text-xs text-gray-400 mt-0.5">{q.date}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Manuel dato */}
      <div className="rounded-xl bg-white p-5 ring-1 ring-gray-200">
        <h2 className="mb-3 text-sm font-semibold text-gray-700">Vælg specifik dato</h2>
        <div className="flex gap-3">
          <input type="date" value={date} onChange={e => setDate(e.target.value)}
            className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none" />
          <button onClick={go}
            className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700">
            Åbn <ArrowRight size={15} />
          </button>
        </div>
      </div>
    </div>
  )
}
