'use client'

import { useEffect, useState } from 'react'

function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  return Uint8Array.from(Array.from(raw, c => c.charCodeAt(0)))
}

export default function PushSubscribeButton() {
  const [status, setStatus] = useState<'loading' | 'unsupported' | 'denied' | 'subscribed' | 'unsubscribed'>('loading')
  const [working, setWorking] = useState(false)

  useEffect(() => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      setStatus('unsupported')
      return
    }
    // Sørg for at SW er registreret
    navigator.serviceWorker.register('/sw.js').catch(() => {})

    const perm = Notification.permission
    if (perm === 'denied') { setStatus('denied'); return }

    navigator.serviceWorker.ready.then(reg =>
      reg.pushManager.getSubscription().then(sub => {
        setStatus(sub ? 'subscribed' : 'unsubscribed')
      })
    ).catch(() => setStatus('unsubscribed'))
  }, [])

  async function subscribe() {
    setWorking(true)
    try {
      const perm = await Notification.requestPermission()
      if (perm !== 'granted') { setStatus('denied'); return }

      const reg = await navigator.serviceWorker.ready
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!),
      })
      await fetch('/api/portal/push-subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sub.toJSON()),
      })
      setStatus('subscribed')
    } catch (err) {
      console.error('Push subscribe failed', err)
    } finally {
      setWorking(false)
    }
  }

  async function unsubscribe() {
    setWorking(true)
    try {
      const reg = await navigator.serviceWorker.ready
      const sub = await reg.pushManager.getSubscription()
      if (sub) {
        await fetch('/api/portal/push-subscribe', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        })
        await sub.unsubscribe()
      }
      setStatus('unsubscribed')
    } catch (err) {
      console.error('Push unsubscribe failed', err)
    } finally {
      setWorking(false)
    }
  }

  if (status === 'loading' || status === 'unsupported' || status === 'denied') return null

  if (status === 'subscribed') {
    return (
      <button
        onClick={unsubscribe}
        disabled={working}
        title="Slå push-notifikationer fra"
        className="fixed bottom-20 right-4 z-50 flex h-10 w-10 items-center justify-center rounded-full bg-blue-600 text-white shadow-lg hover:bg-blue-700 md:bottom-6 disabled:opacity-50"
        aria-label="Notifikationer aktiveret — klik for at slå fra"
      >
        <span className="text-base">🔔</span>
      </button>
    )
  }

  return (
    <button
      onClick={subscribe}
      disabled={working}
      title="Aktivér push-notifikationer"
      className="fixed bottom-20 right-4 z-50 flex h-10 w-10 items-center justify-center rounded-full bg-white border border-gray-300 text-gray-500 shadow-lg hover:bg-gray-50 md:bottom-6 disabled:opacity-50"
      aria-label="Aktivér push-notifikationer"
    >
      <span className="text-base">🔕</span>
    </button>
  )
}
