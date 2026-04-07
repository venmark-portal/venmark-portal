'use client'

import { useState, useRef } from 'react'
import {
  Lock, KeyRound, ShieldAlert, MapPin, MessageSquare,
  Camera, Image as ImageIcon, X, Eye, EyeOff, CheckCircle2, Loader2, Truck,
  Bell, Plus, Trash2,
} from 'lucide-react'

interface Photo { data: string; mimeType: string; fileName: string }

interface InitialProfile {
  doorCode?:            string | null
  keyboxCode?:          string | null
  alarmCode?:           string | null
  deliveryDescription?: string | null
  driverMessage?:       string | null
  photos?:              Array<{ data: string; mimeType: string; fileName: string }>
}

interface PodRecipient {
  id?:       string
  name:      string
  email:     string
  phone:     string
  sendEmail: boolean
  sendSms:   boolean
}

interface Props {
  initialProfile?:      InitialProfile | null
  initialPodRecipients?: PodRecipient[]
}

export default function DeliveryProfileForm({ initialProfile, initialPodRecipients }: Props) {
  const [doorCode,            setDoorCode]            = useState(initialProfile?.doorCode            ?? '')
  const [keyboxCode,          setKeyboxCode]          = useState(initialProfile?.keyboxCode          ?? '')
  const [alarmCode,           setAlarmCode]           = useState(initialProfile?.alarmCode           ?? '')
  const [deliveryDescription, setDeliveryDescription] = useState(initialProfile?.deliveryDescription ?? '')
  const [driverMessage,       setDriverMessage]       = useState(initialProfile?.driverMessage       ?? '')
  const [photos,              setPhotos]              = useState<Photo[]>(initialProfile?.photos ?? [])

  const [showDoor,   setShowDoor]   = useState(false)
  const [showKeybox, setShowKeybox] = useState(false)
  const [showAlarm,  setShowAlarm]  = useState(false)

  const [podRecipients, setPodRecipients] = useState<PodRecipient[]>(
    initialPodRecipients ?? []
  )

  const [saving, setSaving] = useState(false)
  const [saved,  setSaved]  = useState(false)
  const [error,  setError]  = useState('')

  const cameraRef  = useRef<HTMLInputElement>(null)
  const galleryRef = useRef<HTMLInputElement>(null)

  async function handlePhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    for (const file of files.slice(0, 3 - photos.length)) {
      await new Promise<void>(resolve => {
        const reader = new FileReader()
        reader.onload = ev => {
          const dataUrl = ev.target?.result as string
          const [meta, data] = dataUrl.split(',')
          const mimeType = meta.match(/:(.*?);/)?.[1] ?? 'image/jpeg'
          setPhotos(prev => [...prev, { data, mimeType, fileName: file.name }])
          resolve()
        }
        reader.readAsDataURL(file)
      })
    }
    e.target.value = ''
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setSaved(false)
    setError('')
    try {
      const [r1, r2] = await Promise.all([
        fetch('/api/portal/delivery-profile', {
          method:  'PUT',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ doorCode, keyboxCode, alarmCode, deliveryDescription, driverMessage, photos }),
        }),
        fetch('/api/portal/pod-recipients', {
          method:  'PUT',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify(podRecipients),
        }),
      ])
      if (!r1.ok) throw new Error(await r1.text())
      if (!r2.ok) throw new Error(await r2.text())
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } catch (e: any) {
      setError(e.message ?? 'Fejl — prøv igen')
    } finally {
      setSaving(false)
    }
  }

  const secretInput = (
    label: string,
    icon: React.ReactNode,
    value: string,
    onChange: (v: string) => void,
    show: boolean,
    setShow: (v: boolean) => void,
    placeholder: string,
  ) => (
    <div>
      <label className="block text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1.5 flex items-center gap-1.5">
        {icon} {label}
      </label>
      <div className="relative">
        <input
          type={show ? 'text' : 'password'}
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          autoComplete="off"
          className="w-full rounded-lg border border-gray-300 px-3 py-2 pr-10 text-sm focus:border-blue-400 focus:outline-none font-mono"
        />
        <button
          type="button"
          onClick={() => setShow(!show)}
          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
        >
          {show ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
      </div>
    </div>
  )

  return (
    <form onSubmit={handleSubmit} className="space-y-4">

      {/* ── Adgangskoder ──────────────────────────────────────────── */}
      <div className="rounded-xl bg-white p-4 ring-1 ring-gray-200 space-y-4">
        <h2 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
          <Lock size={15} className="text-gray-400" /> Adgangskoder
        </h2>
        <p className="text-xs text-gray-400 -mt-2">Gemmes krypteret — kun synlige for chaufføren ved levering</p>

        {secretInput('Dørkodenummer', <KeyRound size={12} />, doorCode, setDoorCode, showDoor, setShowDoor, 'f.eks. 1234#')}
        {secretInput('Nøglebokskode', <Lock size={12} />, keyboxCode, setKeyboxCode, showKeybox, setShowKeybox, 'f.eks. A-2847')}
        {secretInput('Alarmkode', <ShieldAlert size={12} />, alarmCode, setAlarmCode, showAlarm, setShowAlarm, 'f.eks. 9876')}
      </div>

      {/* ── Leveringsbeskrivelse ───────────────────────────────────── */}
      <div className="rounded-xl bg-white p-4 ring-1 ring-gray-200 space-y-3">
        <h2 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
          <MapPin size={15} className="text-gray-400" /> Leveringssted
        </h2>

        <div>
          <label className="block text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1.5">
            Beskrivelse
          </label>
          <textarea
            rows={3}
            value={deliveryDescription}
            onChange={e => setDeliveryDescription(e.target.value)}
            placeholder="f.eks. Kør ind bagved. Grøn port, ring 2x. Sæt varer i køleskur til venstre."
            className="w-full resize-none rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none"
          />
        </div>

        {/* Fotos af leveringssted */}
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1.5">
            Fotos af leveringssted (maks. 3)
          </label>
          <div className="flex flex-wrap gap-2">
            {photos.map((img, i) => (
              <div key={i} className="relative w-24 h-24 rounded-lg overflow-hidden bg-gray-100 ring-1 ring-gray-200">
                <img
                  src={`data:${img.mimeType};base64,${img.data}`}
                  alt={img.fileName}
                  className="w-full h-full object-cover"
                />
                <button
                  type="button"
                  onClick={() => setPhotos(prev => prev.filter((_, j) => j !== i))}
                  className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/60 text-white flex items-center justify-center"
                >
                  <X size={11} />
                </button>
              </div>
            ))}
            {photos.length < 3 && (
              <div className="flex flex-col gap-2">
                <button
                  type="button"
                  onClick={() => cameraRef.current?.click()}
                  className="w-24 h-11 rounded-lg border-2 border-dashed border-gray-300 flex items-center justify-center gap-1.5 text-gray-400 hover:border-blue-400 hover:text-blue-500 transition text-xs font-medium"
                >
                  <Camera size={14} /> Kamera
                </button>
                <button
                  type="button"
                  onClick={() => galleryRef.current?.click()}
                  className="w-24 h-11 rounded-lg border-2 border-dashed border-gray-300 flex items-center justify-center gap-1.5 text-gray-400 hover:border-blue-400 hover:text-blue-500 transition text-xs font-medium"
                >
                  <ImageIcon size={14} /> Galleri
                </button>
              </div>
            )}
          </div>
          {/* Kamera-input (åbner kamera direkte) */}
          <input ref={cameraRef}  type="file" accept="image/*" capture="environment" className="hidden" onChange={handlePhoto} />
          {/* Galleri-input (vælg fra galleri) */}
          <input ref={galleryRef} type="file" accept="image/*" multiple className="hidden" onChange={handlePhoto} />
        </div>
      </div>

      {/* ── Fast besked til chauffør ───────────────────────────────── */}
      <div className="rounded-xl bg-white p-4 ring-1 ring-gray-200 space-y-3">
        <h2 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
          <MessageSquare size={15} className="text-gray-400" /> Fast besked til chauffør
        </h2>
        <p className="text-xs text-gray-400 -mt-2">Vises til chaufføren ved hver levering. Brug ekstra besked ved bestilling til engangs-instrukser.</p>
        <textarea
          rows={3}
          value={driverMessage}
          onChange={e => setDriverMessage(e.target.value)}
          placeholder="f.eks. Ring altid inden levering. Aflever kun til Jens eller Mette."
          className="w-full resize-none rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none"
        />
      </div>

      {/* ── POD-kvittering ────────────────────────────────────────── */}
      <div className="rounded-xl bg-white p-4 ring-1 ring-gray-200 space-y-3">
        <div>
          <h2 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
            <Bell size={15} className="text-gray-400" /> Leveringskvittering
          </h2>
          <p className="text-xs text-gray-400 mt-0.5">
            Modtag automatisk besked med foto når din ordre er leveret.
          </p>
        </div>

        {podRecipients.length === 0 && (
          <p className="text-xs text-gray-400 italic">Ingen modtagere endnu — tilføj herunder.</p>
        )}

        {podRecipients.map((r, i) => (
          <div key={i} className="rounded-lg border border-gray-200 p-3 space-y-2">
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={r.name}
                onChange={e => setPodRecipients(prev => prev.map((x, j) => j === i ? { ...x, name: e.target.value } : x))}
                placeholder="Navn"
                className="flex-1 rounded-lg border border-gray-200 px-3 py-1.5 text-sm focus:border-blue-400 focus:outline-none"
              />
              <button
                type="button"
                onClick={() => setPodRecipients(prev => prev.filter((_, j) => j !== i))}
                className="text-gray-300 hover:text-red-500 transition-colors p-1"
              >
                <Trash2 size={14} />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <input
                type="email"
                value={r.email}
                onChange={e => setPodRecipients(prev => prev.map((x, j) => j === i ? { ...x, email: e.target.value } : x))}
                placeholder="Email"
                className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm focus:border-blue-400 focus:outline-none"
              />
              <input
                type="tel"
                value={r.phone}
                onChange={e => setPodRecipients(prev => prev.map((x, j) => j === i ? { ...x, phone: e.target.value } : x))}
                placeholder="Mobil (SMS)"
                className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm focus:border-blue-400 focus:outline-none"
              />
            </div>
            <div className="flex gap-4">
              <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
                <input
                  type="checkbox"
                  checked={r.sendEmail}
                  onChange={e => setPodRecipients(prev => prev.map((x, j) => j === i ? { ...x, sendEmail: e.target.checked } : x))}
                  className="rounded border-gray-300 text-blue-600"
                />
                Email
              </label>
              <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
                <input
                  type="checkbox"
                  checked={r.sendSms}
                  onChange={e => setPodRecipients(prev => prev.map((x, j) => j === i ? { ...x, sendSms: e.target.checked } : x))}
                  className="rounded border-gray-300 text-blue-600"
                />
                SMS
              </label>
            </div>
          </div>
        ))}

        <button
          type="button"
          onClick={() => setPodRecipients(prev => [...prev, { name: '', email: '', phone: '', sendEmail: true, sendSms: false }])}
          className="flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-700"
        >
          <Plus size={14} /> Tilføj modtager
        </button>
      </div>

      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <button
        type="submit"
        disabled={saving}
        className="w-full rounded-xl bg-blue-600 py-3.5 text-base font-bold text-white shadow-sm transition hover:bg-blue-700 disabled:opacity-40 flex items-center justify-center gap-2"
      >
        {saving  ? <><Loader2 size={18} className="animate-spin" /> Gemmer...</>
        : saved   ? <><CheckCircle2 size={18} /> Gemt!</>
        : 'Gem leveringsoplysninger'}
      </button>
    </form>
  )
}
