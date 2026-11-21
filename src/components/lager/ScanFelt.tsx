'use client'

import { useEffect, useRef, useState } from 'react'
import { Camera, Keyboard, ScanLine, X } from 'lucide-react'

/**
 * Scanne-feltet. Håndterminalen sender stregkoden som tastetryk efterfulgt af Enter —
 * derfor er feltet altid i fokus, og derfor må der ikke ligge andre felter og stjæle
 * fokus. Kameraet er nødudgangen når en kode er krøllet eller terminalen er fladt.
 *
 * To fælder bygget ind:
 *   - Scanneren med US-tastatur sender '-' som '+'. BC normaliserer, men vi viser også
 *     koden rigtigt her, så folk ikke jagter en fejl der ikke findes.
 *   - Et løbende kald der stjæler fokus dræber scanning. Derfor ingen timere der
 *     rører feltet — kun et klik udefra kan flytte fokus, og vi tager det tilbage.
 *   - Ikke alle scannere KAN sættes op til at sende Enter til sidst, og uden Enter
 *     skulle man hive skærmtastaturet frem for at trykke den selv (Claus 21-11).
 *     Derfor sender feltet selv, når tegnene kom i maskinfart og holdt op. Se
 *     MAKS_SPRING herunder.
 */

/** Længste pause mellem to tegn, der stadig kan være en maskine (ms). Et menneske
 *  rammer sjældent under 80 ms tegn for tegn — en scanner ligger typisk på 5-30. */
const MAKS_SPRING = 80
/** Så længe skal der være stille, før vi tror koden er færdig (ms). */
const STILLE_MS = 140
/** Kortere end dette sender vi ikke af os selv — så er det en halv kode. */
const MINDST_TEGN = 4
export default function ScanFelt({
  onScan,
  travl = false,
  placeholder = 'Scan stregkode',
  pause = false,
}: {
  onScan: (kode: string) => void
  travl?: boolean
  placeholder?: string
  /** Slår fokus-jagten HELT fra. Sættes når en dialog er åben: at gætte på
   *  document.activeElement er ikke nok, for på en telefon flytter skærmtastaturet
   *  rundt på fokus af sig selv, og så stjal feltet indtastningen alligevel. */
  pause?: boolean
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [vaerdi, setVaerdi] = useState('')
  const [kamera, setKamera] = useState(false)
  const [kanKamera, setKanKamera] = useState(false)
  const [tast, setTast] = useState(false)
  // Hvad feltet FAKTISK modtog sidst. Kan scanneren ikke sættes op, er det den eneste
  // måde at se om tegnene overhovedet når frem — og hvor hurtigt de kom.
  const [sidste, setSidste] = useState<{ tegn: number; ms: number; auto: boolean; hurtig: boolean } | null>(null)
  // Den aktuelle tekst som en ref. Ved scannerfart når React ikke at gentegne mellem
  // hvert tegn, og så måler vi på en forældet værdi og tror hele koden kom i ét hug.
  const vaerdiRef = useRef('')
  const forrigeTastRef = useRef(0)
  const startTidRef = useRef(0)
  const hurtigRef = useRef(true)
  const stilleRef = useRef(0)

  useEffect(() => {
    // Kamera-scanning findes kun i Chrome på Android, ChromeOS og macOS — IKKE på
    // Windows og ikke i Safari. Derfor skjuler vi knappen i stedet for at vise en
    // knap der fejler, og tilbyder tastaturet som vej ind i stedet.
    setKanKamera(typeof window !== 'undefined' && 'BarcodeDetector' in window)
    // Valget huskes PR. ENHED: en telefon uden scanner skal ikke bede om tastaturet
    // hver eneste gang, og en håndterminal skal ikke have et tastatur hen over
    // skærmen ved hvert scan.
    try {
      setTast(localStorage.getItem('lager-tastemode') === '1')
    } catch { /* privat vindue — så bare uden */ }
  }, [])

  // Hold fokus. Terminalen "taster" ind i det felt der har fokus — mister vi det,
  // forsvinder scanningerne ud i ingenting, og det er umuligt at se hvorfor.
  //
  // MEN: kun når INTET andet felt er i brug. Tager vi fokus mens nogen taster et
  // antal, river vi bogstaverne ud af hånden på dem — og det er præcis sådan
  // "Anslå antal" var umulig at udfylde.
  useEffect(() => {
    if (kamera || pause) return
    const iBrug = () => {
      const a = document.activeElement as HTMLElement | null
      if (!a || a === document.body) return false
      if (a === inputRef.current) return true
      return ['INPUT', 'TEXTAREA', 'SELECT'].includes(a.tagName) || a.isContentEditable
    }
    const tag = () => { if (!iBrug()) inputRef.current?.focus() }
    tag()
    const i = window.setInterval(tag, 1500)
    return () => window.clearInterval(i)
  }, [kamera, pause])

  // Ryd den ventende auto-afsendelse, når komponenten forsvinder.
  useEffect(() => () => window.clearTimeout(stilleRef.current), [])

  function send(kode: string, auto = false) {
    window.clearTimeout(stilleRef.current)
    const renset = kode.trim().replace(/\+/g, '-')
    if (!renset) return
    setSidste({
      tegn: renset.length,
      ms: startTidRef.current ? Date.now() - startTidRef.current : 0,
      auto,
      hurtig: hurtigRef.current,
    })
    forrigeTastRef.current = 0
    startTidRef.current = 0
    vaerdiRef.current = ''
    onScan(renset)
    setVaerdi('')
  }

  /**
   * Hvert tegn der lander i feltet. Vi holder øje med, hvor hurtigt de kommer:
   * kom hele koden i maskinfart, sender vi selv, når der bliver stille. Taster man
   * i hånden (tastetilstand), rører vi ikke ved noget — dér er Enter gratis, fordi
   * tastaturet alligevel er fremme.
   */
  function skriv(ny: string) {
    const nu = Date.now()
    const foer = vaerdiRef.current
    if (!foer) {
      // Ny kode begynder: start måling forfra.
      hurtigRef.current = true
      startTidRef.current = nu
    } else {
      // Kom flere tegn i ét hug, er det en scanner der indsætter hele koden — den har
      // ingen mellemrum at måle på, og den skal ikke dømmes langsom.
      const iEtHug = ny.length > foer.length + 1
      if (!iEtHug && nu - forrigeTastRef.current > MAKS_SPRING) hurtigRef.current = false
    }
    forrigeTastRef.current = nu
    vaerdiRef.current = ny
    setVaerdi(ny)

    window.clearTimeout(stilleRef.current)
    if (tast || !hurtigRef.current || ny.trim().length < MINDST_TEGN) return
    stilleRef.current = window.setTimeout(() => send(ny, true), STILLE_MS)
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <ScanLine
            size={20}
            className={`pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 ${travl ? 'animate-pulse text-emerald-600' : 'text-gray-400'}`}
          />
          <input
            ref={inputRef}
            value={vaerdi}
            onChange={e => skriv(e.target.value)}
            onKeyDown={e => {
              // Enter er det normale. Tab tager vi med, fordi en del scannere sender
              // den i stedet — og uden det ville koden bare hoppe videre til næste
              // knap og forsvinde.
              if (e.key === 'Enter' || e.key === 'Tab') {
                e.preventDefault()
                send(vaerdiRef.current || vaerdi)
              }
            }}
            // none = intet skærmtastatur der dækker halve skærmen ved hvert scan.
            // Tastatur-knappen slår det til når koden skal tastes — og et fysisk
            // tastatur virker altid, så en PC kan bruges til test uden scanner.
            inputMode={tast ? 'text' : 'none'}
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            placeholder={placeholder}
            className="w-full rounded-2xl border-2 border-gray-300 py-4 pl-11 pr-3 text-lg font-mono tracking-wide focus:border-emerald-600 focus:outline-none"
          />
        </div>
        {kanKamera && (
          <button
            type="button"
            onClick={() => setKamera(true)}
            className="rounded-2xl bg-gray-900 px-4 text-white"
            aria-label="Scan med kamera"
          >
            <Camera size={22} />
          </button>
        )}
        <button
          type="button"
          onClick={() => {
            setTast(t => {
              try { localStorage.setItem('lager-tastemode', t ? '0' : '1') } catch { /* ingen */ }
              return !t
            })
            // Skærmtastaturet kommer først når feltet får fokus igen med den nye tilstand.
            setTimeout(() => inputRef.current?.focus(), 0)
          }}
          className={
            'rounded-2xl px-4 ' + (tast ? 'bg-gray-900 text-white' : 'bg-white text-gray-500 ring-1 ring-gray-300')
          }
          aria-label="Tast koden i stedet"
          title="Tast koden i stedet for at scanne"
        >
          <Keyboard size={22} />
        </button>
      </div>

      {tast && (
        <p className="text-xs text-gray-500">
          Tastetilstand: skriv koden og tryk Enter. Et fysisk tastatur virker altid — også uden scanner.
        </p>
      )}

      {/* Hvad feltet modtog. Står der ingenting efter et scan, er tegnene slet ikke
          nået frem — og så er det scanneren eller fokus, der er galt, ikke opslaget. */}
      {sidste && (
        <p className="text-xs text-gray-500">
          Modtog {sidste.tegn} tegn på {sidste.ms} ms —{' '}
          {sidste.auto
            ? 'sendt automatisk'
            : sidste.hurtig
              ? 'sendt med Enter'
              : 'for langsomt til at sende selv, så Enter var nødvendig'}
        </p>
      )}

      {kamera && (
        <Kamera
          onKode={kode => {
            setKamera(false)
            send(kode)
          }}
          onLuk={() => setKamera(false)}
        />
      )}
    </div>
  )
}

/** Kamera-scanning med browserens egen BarcodeDetector — ingen ekstra bibliotek. */
function Kamera({ onKode, onLuk }: { onKode: (kode: string) => void; onLuk: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [fejl, setFejl] = useState('')

  useEffect(() => {
    let stream: MediaStream | null = null
    let stop = false
    let timer = 0

    async function start() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
        })
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          await videoRef.current.play()
        }
        const Detector = (window as any).BarcodeDetector
        const detector = new Detector({
          formats: ['ean_13', 'ean_8', 'code_128', 'code_39', 'qr_code', 'itf'],
        })
        const kig = async () => {
          if (stop || !videoRef.current) return
          try {
            const fund = await detector.detect(videoRef.current)
            if (fund?.[0]?.rawValue) {
              onKode(String(fund[0].rawValue))
              return
            }
          } catch {
            /* enkelt billede kunne ikke læses — prøv igen */
          }
          timer = window.setTimeout(kig, 250)
        }
        kig()
      } catch (e: any) {
        setFejl(e?.message ?? 'Kameraet kunne ikke startes')
      }
    }
    start()

    return () => {
      stop = true
      window.clearTimeout(timer)
      stream?.getTracks().forEach(t => t.stop())
    }
  }, [onKode])

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black">
      <button
        type="button"
        onClick={onLuk}
        className="absolute right-4 top-4 z-10 rounded-full bg-white/90 p-2"
        aria-label="Luk kamera"
      >
        <X size={22} />
      </button>
      <video ref={videoRef} playsInline muted className="h-full w-full object-cover" />
      {fejl && (
        <p className="absolute bottom-10 left-0 right-0 px-6 text-center text-sm text-white">{fejl}</p>
      )}
    </div>
  )
}
