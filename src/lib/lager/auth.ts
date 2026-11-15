// Adgang til lager-appens API. Alle ruter spørger her, så reglen står ét sted.
// En admin må altid med: kontoret skal kunne se og rette uden at låne en håndterminal.

import { NextRequest } from 'next/server'
import { getToken } from 'next-auth/jwt'

export interface LagerBruger {
  id: string
  navn: string
  initialer: string
  rolle: string
  lokation: string
  maaTaelle: boolean
  maaPakke: boolean
}

export async function lagerBruger(req: NextRequest): Promise<LagerBruger | null> {
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET })
  if (!token) return null
  const rolle = String(token.role ?? '')
  if (rolle !== 'lager' && rolle !== 'admin') return null
  const admin = rolle === 'admin'
  return {
    id: String(token.sub ?? ''),
    navn: String(token.name ?? ''),
    initialer: String((token as any).lagerInitials ?? ''),
    rolle,
    lokation: String((token as any).lagerLocation ?? ''),
    maaTaelle: admin || !!(token as any).lagerCanCount,
    maaPakke: admin || !!(token as any).lagerCanPack,
  }
}
