'use client'

// Skift medarbejderens rolle i browseren. Det er det samme kald som next-auth's update()
// laver (POST /api/auth/session), bare uden at kræve en SessionProvider — så det også
// virker fra login-siderne. Serveren (jwt-callback i lib/auth.ts) afgør om rollen er lovlig.

export type KlientRolle = 'admin' | 'lager' | 'chauffoer' | 'kunde'

export const ROLLE_START: Record<KlientRolle, string> = {
  kunde: '/portal', lager: '/lager', admin: '/admin', chauffoer: '/chauffeur',
}

/** Skifter rolle og returnerer den rolle sessionen har bagefter (next-auth-rollen). */
export async function skiftRolle(rolle: KlientRolle): Promise<string | null> {
  const { csrfToken } = await fetch('/api/auth/csrf', { cache: 'no-store' }).then(r => r.json())
  const s = await fetch('/api/auth/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ csrfToken, data: { rolle } }),
    cache: 'no-store',
  }).then(r => r.json()).catch(() => null)
  return s?.user?.role ?? null
}

/** next-auth-rolle → medarbejder-rolle (til at vise hvilken man står i). */
export function somKlientRolle(role: string | undefined): KlientRolle | null {
  return role === 'admin' ? 'admin' : role === 'lager' ? 'lager' : role === 'driver' ? 'chauffoer' : role === 'customer' ? 'kunde' : null
}
