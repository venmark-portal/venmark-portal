'use client'

import { useState } from 'react'
import { Download, FileSpreadsheet } from 'lucide-react'

export default function KontoudtogWidget() {
  const today    = new Date().toISOString().split('T')[0]
  const yearAgo  = new Date(Date.now() - 365 * 86400_000).toISOString().split('T')[0]

  const [from,     setFrom]     = useState(yearAgo)
  const [to,       setTo]       = useState(today)
  const [loading,  setLoading]  = useState(false)

  async function download() {
    setLoading(true)
    try {
      const url = `/api/portal/kontoudtog?from=${from}&to=${to}`
      const res = await fetch(url)
      if (!res.ok) { alert('Fejl ved hentning af kontoudtog'); return }

      const blob     = await res.blob()
      const dlUrl    = URL.createObjectURL(blob)
      const a        = document.createElement('a')
      a.href         = dlUrl
      a.download     = `Kontoudtog-${from}-${to}.csv`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(dlUrl)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="rounded-xl bg-white ring-1 ring-gray-200 p-4">
      <div className="flex items-center gap-2 mb-3">
        <FileSpreadsheet size={16} className="text-green-600" />
        <span className="text-sm font-semibold text-gray-800">Kontoudtog som Excel</span>
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex items-center gap-1.5">
          <label className="text-xs text-gray-500 shrink-0">Fra</label>
          <input
            type="date"
            value={from}
            max={to}
            onChange={e => setFrom(e.target.value)}
            className="rounded-lg border border-gray-200 px-2 py-1 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div className="flex items-center gap-1.5">
          <label className="text-xs text-gray-500 shrink-0">Til</label>
          <input
            type="date"
            value={to}
            min={from}
            max={today}
            onChange={e => setTo(e.target.value)}
            className="rounded-lg border border-gray-200 px-2 py-1 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <button
          onClick={download}
          disabled={loading}
          className="flex items-center gap-1.5 rounded-lg bg-green-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50 transition-colors"
        >
          <Download size={14} />
          {loading ? 'Henter…' : 'Download'}
        </button>
      </div>
      <p className="mt-2 text-xs text-gray-400">
        Åbn CSV-filen i Excel — den understøtter æøå og danske beløb
      </p>
    </div>
  )
}
