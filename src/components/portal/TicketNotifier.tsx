'use client'

import { useEffect, useRef, useState } from 'react'

function playBeep() {
  try {
    const ctx  = new (window.AudioContext || (window as any).webkitAudioContext)()
    const osc  = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.type            = 'sine'
    osc.frequency.value = 880
    gain.gain.value     = 0.2
    osc.start()
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4)
    osc.stop(ctx.currentTime + 0.4)
  } catch {}
}

export default function TicketNotifier() {
  const lastCount = useRef<number | null>(null)
  const [badge, setBadge] = useState(0)

  async function check() {
    try {
      const res = await fetch('/api/portal/reklamationer/unread', { cache: 'no-store' })
      if (!res.ok) return
      const { unreadMessages } = await res.json()
      if (lastCount.current !== null && unreadMessages > lastCount.current) {
        playBeep()
        // Vis et lille toast
        const toast = document.createElement('div')
        toast.textContent = '💬 Ny besked på din reklamation'
        toast.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:#1d4ed8;color:#fff;padding:10px 18px;border-radius:999px;font-size:14px;font-weight:600;z-index:9999;box-shadow:0 4px 12px rgba(0,0,0,0.2)'
        document.body.appendChild(toast)
        setTimeout(() => toast.remove(), 4000)
      }
      lastCount.current = unreadMessages
      setBadge(unreadMessages)
    } catch {}
  }

  useEffect(() => {
    check()
    const interval = setInterval(check, 30000)
    return () => clearInterval(interval)
  }, [])

  // Eksportér badge-antal via custom event så PortalNav kan vise det
  useEffect(() => {
    window.dispatchEvent(new CustomEvent('ticketBadge', { detail: badge }))
  }, [badge])

  return null  // Usynlig komponent
}
