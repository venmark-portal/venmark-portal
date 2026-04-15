'use client'

// Foto-station: kører som en browser-tab på pakstationen (Windows 11).
// Poller /api/foto/pending hvert sekund. Når et pending-request ankommer,
// fanges billede automatisk fra kamera og uploades til portalen.
//
// URL: /foto-station?stationId=PAK1&camera=0
//   stationId: identifikator for denne pakstation (default: "default")
//   camera:    kameraindeks hvis der er flere (default: 0)

import { useEffect, useRef, useState, useCallback } from 'react'

interface PendingCapture {
  id: string
  bcBoxEntryNo: number
  stationId: string
  requestedAt: string
}

export default function FotoStationPage() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const pollingRef = useRef<NodeJS.Timeout | null>(null)

  const [stationId, setStationId] = useState('default')
  const [status, setStatus] = useState<'starting' | 'ready' | 'capturing' | 'error'>('starting')
  const [lastCapture, setLastCapture] = useState<{ entryNo: number; time: string } | null>(null)
  const [captureCount, setCaptureCount] = useState(0)
  const [errorMsg, setErrorMsg] = useState('')

  // Læs stationId fra URL
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    setStationId(params.get('stationId') || 'default')
  }, [])

  // Start kamera
  useEffect(() => {
    async function startCamera() {
      try {
        const params = new URLSearchParams(window.location.search)
        const cameraIdx = parseInt(params.get('camera') || '0')

        const devices = await navigator.mediaDevices.enumerateDevices()
        const videoDevices = devices.filter(d => d.kind === 'videoinput')
        const deviceId = videoDevices[cameraIdx]?.deviceId

        const constraints: MediaStreamConstraints = {
          video: deviceId
            ? { deviceId: { exact: deviceId }, width: 1280, height: 960 }
            : { width: 1280, height: 960 },
        }

        const stream = await navigator.mediaDevices.getUserMedia(constraints)
        streamRef.current = stream
        if (videoRef.current) {
          videoRef.current.srcObject = stream
        }
        setStatus('ready')
      } catch (e) {
        setStatus('error')
        setErrorMsg('Kamera ikke tilgængeligt: ' + (e as Error).message)
      }
    }
    startCamera()
    return () => {
      streamRef.current?.getTracks().forEach(t => t.stop())
    }
  }, [])

  const captureAndUpload = useCallback(async (pending: PendingCapture) => {
    const video = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas) return

    setStatus('capturing')

    canvas.width = video.videoWidth || 1280
    canvas.height = video.videoHeight || 960
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(video, 0, 0)

    const blob = await new Promise<Blob | null>(resolve =>
      canvas.toBlob(resolve, 'image/jpeg', 0.85)
    )
    if (!blob) {
      setStatus('ready')
      return
    }

    const form = new FormData()
    form.append('foto', blob, `kasse-${pending.bcBoxEntryNo}.jpg`)
    form.append('bcBoxEntryNo', String(pending.bcBoxEntryNo))
    form.append('pendingId', pending.id)

    try {
      await fetch('/api/foto/upload', { method: 'POST', body: form })
      setLastCapture({
        entryNo: pending.bcBoxEntryNo,
        time: new Date().toLocaleTimeString('da-DK'),
      })
      setCaptureCount(n => n + 1)
    } catch {
      // Upload fejl — marker stadig som captured for ikke at loop
      await fetch('/api/foto/pending', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: pending.id }),
      })
    }

    setStatus('ready')
  }, [])

  // Polling
  useEffect(() => {
    if (status === 'error') return

    pollingRef.current = setInterval(async () => {
      if (status !== 'ready') return
      try {
        const res = await fetch(`/api/foto/pending?stationId=${stationId}`)
        const pending: PendingCapture | null = await res.json()
        if (pending) {
          await captureAndUpload(pending)
        }
      } catch {
        // netværksfejl — prøv igen næste poll
      }
    }, 1000)

    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current)
    }
  }, [status, stationId, captureAndUpload])

  return (
    <div className="min-h-screen bg-gray-900 text-white flex flex-col items-center p-4">
      <div className="w-full max-w-2xl">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-xl font-bold">Foto-station</h1>
          <div className="flex items-center gap-3">
            <span className="text-gray-400 text-sm">Station: {stationId}</span>
            <span className={`px-3 py-1 rounded-full text-sm font-medium ${
              status === 'ready' ? 'bg-green-600' :
              status === 'capturing' ? 'bg-yellow-500 animate-pulse' :
              status === 'starting' ? 'bg-blue-600' :
              'bg-red-600'
            }`}>
              {status === 'ready' ? 'Klar' :
               status === 'capturing' ? 'Optager...' :
               status === 'starting' ? 'Starter...' : 'Fejl'}
            </span>
          </div>
        </div>

        {status === 'error' && (
          <div className="bg-red-900 border border-red-500 rounded p-4 mb-4 text-sm">
            {errorMsg}
          </div>
        )}

        <div className="relative rounded-lg overflow-hidden bg-black aspect-[4/3] mb-4">
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="w-full h-full object-cover"
          />
          {status === 'capturing' && (
            <div className="absolute inset-0 bg-white opacity-30 animate-ping" />
          )}
        </div>

        <canvas ref={canvasRef} className="hidden" />

        <div className="bg-gray-800 rounded-lg p-4">
          <div className="text-sm text-gray-400 mb-1">Seneste billede</div>
          {lastCapture ? (
            <div className="font-mono text-lg">
              Kasse #{lastCapture.entryNo} — {lastCapture.time}
            </div>
          ) : (
            <div className="text-gray-500">Afventer label-print...</div>
          )}
          <div className="text-sm text-gray-400 mt-2">
            Total i dag: <span className="text-white font-bold">{captureCount}</span> billeder
          </div>
        </div>
      </div>
    </div>
  )
}
