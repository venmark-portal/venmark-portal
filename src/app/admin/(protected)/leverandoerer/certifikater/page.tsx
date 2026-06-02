'use client'

import { useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle2, Clock, RefreshCw } from 'lucide-react'

type CertEntry = { number: string; expiry: string }
type Row = {
  id: string
  bcVendorNo: string
  companyName: string | null
  certTypes: string[] | null
  certData: Record<string, CertEntry> | null
  status: string
  updatedAt: string
}

const CERT_LABELS: Record<string, string> = {
  ISO22000: 'ISO 22000', FSSC: 'FSSC 22000', BRC: 'BRCGS', IFS: 'IFS Food',
  MSC: 'MSC', ASC: 'ASC', GLOBALG: 'GlobalG.A.P.', OTHER: 'Anden',
}

function expiryColor(expiry: string | undefined): string {
  if (!expiry) return 'text-gray-400'
  const d = new Date(expiry)
  const days = (d.getTime() - Date.now()) / (1000 * 60 * 60 * 24)
  if (days < 0)   return 'text-red-600 font-semibold'
  if (days < 60)  return 'text-orange-500 font-semibold'
  return 'text-green-700'
}

function ExpiryBadge({ expiry }: { expiry?: string }) {
  if (!expiry) return <span className="text-gray-300 text-xs">—</span>
  const d = new Date(expiry)
  const days = Math.round((d.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
  const label = d.toLocaleDateString('da-DK')
  if (days < 0)  return <span className="text-xs text-red-600 font-semibold flex items-center gap-1"><AlertTriangle size={11}/>{label} (udløbet)</span>
  if (days < 60) return <span className="text-xs text-orange-500 font-semibold flex items-center gap-1"><Clock size={11}/>{label} ({days} dage)</span>
  return <span className={`text-xs ${expiryColor(expiry)} flex items-center gap-1`}><CheckCircle2 size={11}/>{label}</span>
}

export default function CertifikaterPage() {
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [certCols, setCertCols] = useState<string[]>([])

  useEffect(() => {
    fetch('/api/admin/leverandoerer')
      .then(r => r.json())
      .then((data: any[]) => {
        const mapped: Row[] = data
          .filter(d => d.status !== 'PENDING' || d.certData || d.certTypes)
          .map(d => ({
            id: d.id,
            bcVendorNo: d.bcVendorNo,
            companyName: d.companyName,
            certTypes: d.certTypes ? JSON.parse(d.certTypes) : null,
            certData:  d.certData  ? JSON.parse(d.certData)  : null,
            status: d.status,
            updatedAt: d.updatedAt,
          }))

        // Find alle certificeringstyper på tværs af leverandører
        const allCerts = new Set<string>()
        mapped.forEach(r => r.certTypes?.forEach((c: string) => allCerts.add(c)))
        setCertCols(Array.from(allCerts))
        setRows(mapped)
      })
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <div className="py-12 text-center text-sm text-gray-400">Indlæser…</div>

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Certifikatoversigt</h1>
        <p className="text-sm text-gray-500">Udløbsdatoer for alle leverandørers certifikater</p>
      </div>

      {/* Farveforklaring */}
      <div className="flex gap-4 text-xs text-gray-500 flex-wrap">
        <span className="flex items-center gap-1"><CheckCircle2 size={12} className="text-green-600"/>OK</span>
        <span className="flex items-center gap-1"><Clock size={12} className="text-orange-500"/>Udløber &lt;60 dage</span>
        <span className="flex items-center gap-1"><AlertTriangle size={12} className="text-red-600"/>Udløbet</span>
        <span className="flex items-center gap-1 text-gray-300">— Ikke angivet</span>
      </div>

      <div className="overflow-x-auto rounded-xl ring-1 ring-gray-200">
        <table className="w-full text-sm bg-white">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50">
              <th className="text-left px-4 py-3 font-medium text-gray-600 whitespace-nowrap">Leverandør</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Nr.</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Status</th>
              {certCols.map(c => (
                <th key={c} className="text-left px-4 py-3 font-medium text-gray-600 whitespace-nowrap min-w-[140px]">
                  {CERT_LABELS[c] ?? c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={3 + certCols.length} className="text-center py-8 text-gray-400">Ingen erklæringer med certifikatdata</td></tr>
            ) : rows.map(r => (
              <tr key={r.id} className="border-b border-gray-50 hover:bg-gray-50">
                <td className="px-4 py-3 font-medium text-gray-800 whitespace-nowrap">
                  {r.companyName || r.bcVendorNo}
                </td>
                <td className="px-4 py-3 text-gray-500 text-xs">{r.bcVendorNo}</td>
                <td className="px-4 py-3">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${
                    r.status === 'APPROVED'  ? 'bg-green-100 text-green-800' :
                    r.status === 'SUBMITTED' ? 'bg-blue-100 text-blue-800' :
                    'bg-yellow-100 text-yellow-800'
                  }`}>{r.status === 'APPROVED' ? 'Godkendt' : r.status === 'SUBMITTED' ? 'Indsendt' : 'Afventer'}</span>
                </td>
                {certCols.map(c => {
                  const hasCert = r.certTypes?.includes(c)
                  const certEntry = r.certData?.[c]
                  return (
                    <td key={c} className="px-4 py-3">
                      {!hasCert ? (
                        <span className="text-xs text-gray-300">Ikke valgt</span>
                      ) : (
                        <div>
                          {certEntry?.number && <p className="text-xs text-gray-600 mb-0.5">{certEntry.number}</p>}
                          <ExpiryBadge expiry={certEntry?.expiry} />
                        </div>
                      )}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
