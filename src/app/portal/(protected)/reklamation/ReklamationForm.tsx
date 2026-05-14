'use client'

import { useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { Camera, Image as ImageIcon, X, CheckCircle2, Loader2, AlertTriangle } from 'lucide-react'

interface ImageData { data: string; mimeType: string; fileName: string }

export default function ReklamationForm() {
  const router = useRouter()
  const cameraRef    = useRef<HTMLInputElement>(null)
  const galleryRef   = useRef<HTMLInputElement>(null)
  const imageSection = useRef<HTMLDivElement>(null)
  const [subject,         setSubject]         = useState('')
  const [body,            setBody]            = useState('')
  const [orderRef,        setOrderRef]        = useState('')
  const [images,          setImages]          = useState<ImageData[]>([])
  const [saving,          setSaving]          = useState(false)
  const [done,            setDone]            = useState(false)
  const [error,           setError]           = useState('')
  const [showNoBillede,   setShowNoBillede]   = useState(false)
  const [bekraeftNoBill,  setBekraeftNoBill]  = useState(false)

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    for (const file of files.slice(0, 5 - images.length)) {
      const reader = new FileReader()
      reader.onload = (ev) => {
        const dataUrl = ev.target?.result as string
        const [meta, data] = dataUrl.split(',')
        const mimeType = meta.match(/:(.*?);/)?.[1] ?? 'image/jpeg'
        setImages(prev => [...prev, { data, mimeType, fileName: file.name }])
      }
      reader.readAsDataURL(file)
    }
    e.target.value = ''
  }

  async function doSubmit() {
    setSaving(true)
    setError('')
    try {
      const res = await fetch('/api/portal/reklamation', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ subject, body, orderRef, images }),
      })
      if (!res.ok) throw new Error(await res.text())
      setDone(true)
    } catch (e: any) {
      setError(e.message ?? 'Fejl — prøv igen')
    } finally {
      setSaving(false)
      setShowNoBillede(false)
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!subject.trim() || !body.trim()) return
    if (images.length === 0) {
      setBekraeftNoBill(false)
      setShowNoBillede(true)
      return
    }
    await doSubmit()
  }

  if (done) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 rounded-2xl bg-white py-16 text-center ring-1 ring-gray-200">
        <CheckCircle2 size={52} className="text-green-500" />
        <div>
          <h2 className="text-xl font-bold text-gray-900">Reklamation modtaget!</h2>
          <p className="mt-1 text-sm text-gray-500">Vi vender tilbage snarest muligt</p>
        </div>
        <button
          onClick={() => router.push('/portal')}
          className="mt-2 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-700"
        >
          Tilbage til forsiden
        </button>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="rounded-xl bg-white p-4 ring-1 ring-gray-200 space-y-4">
        {/* Emne */}
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1.5">
            Emne *
          </label>
          <input
            type="text"
            value={subject}
            onChange={e => setSubject(e.target.value)}
            required
            placeholder="f.eks. Forkert vare leveret"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none"
          />
        </div>

        {/* Ordrenummer */}
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1.5">
            Ordrenummer (valgfri)
          </label>
          <input
            type="text"
            value={orderRef}
            onChange={e => setOrderRef(e.target.value)}
            placeholder="f.eks. SO-1234"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none"
          />
        </div>

        {/* Beskrivelse */}
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1.5">
            Beskrivelse *
          </label>
          <textarea
            rows={5}
            value={body}
            onChange={e => setBody(e.target.value)}
            required
            placeholder="Beskriv problemet så detaljeret som muligt..."
            className="w-full resize-none rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none"
          />
        </div>

        {/* Billeder */}
        <div ref={imageSection}>
          <label className="block text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1.5">
            Billeder (maks. 5)
          </label>
          <div className="flex flex-wrap gap-2">
            {images.map((img, i) => (
              <div key={i} className="relative w-20 h-20 rounded-lg overflow-hidden bg-gray-100">
                <img
                  src={`data:${img.mimeType};base64,${img.data}`}
                  alt={img.fileName}
                  className="w-full h-full object-cover"
                />
                <button
                  type="button"
                  onClick={() => setImages(prev => prev.filter((_, j) => j !== i))}
                  className="absolute top-0.5 right-0.5 w-5 h-5 rounded-full bg-black/60 text-white flex items-center justify-center"
                >
                  <X size={11} />
                </button>
              </div>
            ))}
            {images.length < 5 && (
              <div className="flex flex-col gap-1.5">
                <button
                  type="button"
                  onClick={() => cameraRef.current?.click()}
                  className="w-20 h-9 rounded-lg border-2 border-dashed border-gray-300 flex items-center justify-center gap-1 text-gray-400 hover:border-blue-400 hover:text-blue-500 transition"
                >
                  <Camera size={14} />
                  <span className="text-[11px] font-medium">Kamera</span>
                </button>
                <button
                  type="button"
                  onClick={() => galleryRef.current?.click()}
                  className="w-20 h-9 rounded-lg border-2 border-dashed border-gray-300 flex items-center justify-center gap-1 text-gray-400 hover:border-blue-400 hover:text-blue-500 transition"
                >
                  <ImageIcon size={14} />
                  <span className="text-[11px] font-medium">Galleri</span>
                </button>
              </div>
            )}
          </div>
          {/* Kamera (åbner kamera direkte på mobil) */}
          <input ref={cameraRef}  type="file" accept="image/*" capture="environment" className="hidden" onChange={handleFileChange} />
          {/* Galleri */}
          <input ref={galleryRef} type="file" accept="image/*" multiple className="hidden" onChange={handleFileChange} />
        </div>
      </div>

      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <button
        type="submit"
        disabled={saving || !subject.trim() || !body.trim()}
        className="w-full rounded-xl bg-blue-600 py-3.5 text-base font-bold text-white shadow-sm transition hover:bg-blue-700 disabled:opacity-40 flex items-center justify-center gap-2"
      >
        {saving ? <><Loader2 size={18} className="animate-spin" /> Sender...</> : 'Send reklamation'}
      </button>

      {/* Dialog: ingen billede vedhæftet */}
      {showNoBillede && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-4" onClick={() => setShowNoBillede(false)}>
          <div className="w-full max-w-sm rounded-2xl bg-white shadow-xl overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="bg-amber-50 px-5 pt-5 pb-4 flex gap-3">
              <AlertTriangle size={22} className="shrink-0 text-amber-500 mt-0.5" />
              <div>
                <h3 className="text-base font-bold text-gray-900">Har du husket dokumentation?</h3>
                <p className="mt-1 text-sm text-gray-600">
                  Et billede af problemet er ofte afgørende for at behandle din reklamation hurtigt — og sparer en opringning.
                </p>
              </div>
            </div>
            <div className="px-5 py-4 space-y-3">
              <button
                onClick={() => {
                  setShowNoBillede(false)
                  setTimeout(() => {
                    imageSection.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
                    cameraRef.current?.click()
                  }, 100)
                }}
                className="w-full rounded-xl bg-blue-600 py-3 text-sm font-bold text-white hover:bg-blue-700 transition flex items-center justify-center gap-2"
              >
                <Camera size={16} /> Tilføj billede nu
              </button>
              <label className="flex items-start gap-3 cursor-pointer rounded-xl border border-gray-200 px-4 py-3 hover:bg-gray-50 transition">
                <input
                  type="checkbox"
                  checked={bekraeftNoBill}
                  onChange={e => setBekraeftNoBill(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded accent-blue-600"
                />
                <span className="text-sm text-gray-700">Jeg har ikke et billede — send reklamationen uden</span>
              </label>
              {bekraeftNoBill && (
                <button
                  onClick={doSubmit}
                  disabled={saving}
                  className="w-full rounded-xl bg-gray-700 py-3 text-sm font-bold text-white hover:bg-gray-800 disabled:opacity-40 transition flex items-center justify-center gap-2"
                >
                  {saving ? <><Loader2 size={16} className="animate-spin" /> Sender...</> : 'Send uden billede'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </form>
  )
}
