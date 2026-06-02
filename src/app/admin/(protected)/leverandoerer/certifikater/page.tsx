'use client'

import { useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle2, Clock, Pencil, Save, X } from 'lucide-react'

const CERT_LABELS: Record<string, string> = {
  ISO22000: 'ISO 22000', FSSC: 'FSSC 22000', BRC: 'BRCGS', IFS: 'IFS Food',
  MSC: 'MSC', ASC: 'ASC', GLOBALG: 'GlobalG.A.P.', OTHER: 'Anden',
}

type Cert = {
  id: string; bcVendorNo: string; companyName: string | null
  certType: string; certNumber: string | null; certExpiry: string | null; updatedAt: string
}

function daysTo(expiry: string | null) {
  if (!expiry) return null
  return Math.round((new Date(expiry).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
}

function ExpiryCell({ expiry }: { expiry: string | null }) {
  const days = daysTo(expiry)
  if (days === null) return <span className="text-gray-300 text-xs">—</span>
  const label = new Date(expiry!).toLocaleDateString('da-DK')
  if (days < 0)  return <span className="flex items-center gap-1 text-xs text-red-600 font-semibold"><AlertTriangle size={11}/>{label}</span>
  if (days < 60) return <span className="flex items-center gap-1 text-xs text-orange-500 font-semibold"><Clock size={11}/>{label} ({days}d)</span>
  return <span className="flex items-center gap-1 text-xs text-green-700"><CheckCircle2 size={11}/>{label}</span>
}

export default function CertifikaterPage() {
  const [certs, setCerts]     = useState<Cert[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<string | null>(null)
  const [editVal, setEditVal] = useState({ certNumber: '', certExpiry: '' })
  const [saving, setSaving]   = useState(false)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const r = await fetch('/api/admin/certifikater')
    if (r.ok) setCerts(await r.json())
    setLoading(false)
  }

  function startEdit(c: Cert) {
    setEditing(c.id)
    setEditVal({
      certNumber: c.certNumber ?? '',
      certExpiry: c.certExpiry ? c.certExpiry.split('T')[0] : '',
    })
  }

  async function saveEdit(c: Cert) {
    setSaving(true)
    await fetch('/api/admin/certifikater', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bcVendorNo: c.bcVendorNo, certType: c.certType, ...editVal }),
    })
    setEditing(null)
    await load()
    setSaving(false)
  }

  // Grupper pr. leverandør
  const byVendor = certs.reduce((acc, c) => {
    if (!acc[c.bcVendorNo]) acc[c.bcVendorNo] = { name: c.companyName, certs: [] }
    acc[c.bcVendorNo].certs.push(c)
    return acc
  }, {} as Record<string, { name: string | null; certs: Cert[] }>)

  // Find alle certifikattyper
  const allTypes = Array.from(new Set(certs.map(c => c.certType)))

  if (loading) return <div className="py-12 text-center text-sm text-gray-400">Indlæser…</div>

  return (
    <div className="space-y-4 max-w-6xl">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Certifikatoversigt</h1>
        <p className="text-sm text-gray-500">Certifikater pr. leverandør — opdateres når leverandør indsender ny erklæring. Admin kan rette manuelt.</p>
      </div>

      <div className="flex gap-4 text-xs text-gray-500">
        <span className="flex items-center gap-1"><CheckCircle2 size={12} className="text-green-600"/>OK</span>
        <span className="flex items-center gap-1"><Clock size={12} className="text-orange-500"/>Udløber &lt;60 dage</span>
        <span className="flex items-center gap-1"><AlertTriangle size={12} className="text-red-600"/>Udløbet</span>
      </div>

      {Object.keys(byVendor).length === 0 ? (
        <div className="bg-white rounded-xl ring-1 ring-gray-200 p-8 text-center text-gray-400 text-sm">
          Ingen certifikatdata endnu. Certifikater udfyldes af leverandøren i erklæringsformularen.
        </div>
      ) : (
        <div className="bg-white rounded-xl ring-1 ring-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="text-left px-4 py-3 font-medium text-gray-600">Leverandør</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Certifikat</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Nummer</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Udløbsdato</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Opdateret</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(byVendor).map(([vendorNo, { name, certs: vCerts }]) =>
                vCerts.map((c, i) => (
                  <tr key={c.id} className="border-b border-gray-50 hover:bg-gray-50">
                    {i === 0 && (
                      <td rowSpan={vCerts.length} className="px-4 py-3 font-medium text-gray-800 align-top border-r border-gray-100">
                        <div>{name || vendorNo}</div>
                        <div className="text-xs text-gray-400">{vendorNo}</div>
                      </td>
                    )}
                    <td className="px-4 py-3 font-medium text-gray-700">{CERT_LABELS[c.certType] ?? c.certType}</td>
                    <td className="px-4 py-3">
                      {editing === c.id ? (
                        <input type="text" value={editVal.certNumber}
                          onChange={e => setEditVal(v => ({ ...v, certNumber: e.target.value }))}
                          className="w-32 rounded border border-blue-300 px-2 py-1 text-xs focus:outline-none"
                        />
                      ) : (
                        <span className="text-gray-600">{c.certNumber || <span className="text-gray-300">—</span>}</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {editing === c.id ? (
                        <input type="date" value={editVal.certExpiry}
                          onChange={e => setEditVal(v => ({ ...v, certExpiry: e.target.value }))}
                          className="rounded border border-blue-300 px-2 py-1 text-xs focus:outline-none"
                        />
                      ) : (
                        <ExpiryCell expiry={c.certExpiry} />
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-400">
                      {new Date(c.updatedAt).toLocaleDateString('da-DK')}
                    </td>
                    <td className="px-4 py-3">
                      {editing === c.id ? (
                        <div className="flex gap-1">
                          <button onClick={() => saveEdit(c)} disabled={saving}
                            className="flex items-center gap-1 text-xs bg-blue-600 text-white px-2 py-1 rounded hover:bg-blue-700 disabled:opacity-50">
                            <Save size={11}/> Gem
                          </button>
                          <button onClick={() => setEditing(null)}
                            className="flex items-center gap-1 text-xs border border-gray-200 px-2 py-1 rounded hover:border-gray-300">
                            <X size={11}/>
                          </button>
                        </div>
                      ) : (
                        <button onClick={() => startEdit(c)}
                          className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-700">
                          <Pencil size={11}/> Ret
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
