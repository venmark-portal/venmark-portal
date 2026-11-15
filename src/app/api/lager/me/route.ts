import { NextRequest, NextResponse } from 'next/server'
import { getToken } from 'next-auth/jwt'
import { hentLokationer } from '@/lib/lager/bc'
import { hentHylder } from '@/lib/lager/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// GET: hvem er jeg, hvad må jeg, hvilke lokationer og hylder kan jeg vælge.
// Ét kald ved opstart, så appen kan arbejde videre offline bagefter.
export async function GET(req: NextRequest) {
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET })
  if (!token || (token.role !== 'lager' && token.role !== 'admin')) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  const lokation = String((token as any).lagerLocation ?? '')
  const [lokationer, hylder] = await Promise.all([hentLokationer(), hentHylder('')])

  return NextResponse.json({
    id: token.sub ?? '',
    navn: token.name ?? '',
    initialer: (token as any).lagerInitials ?? '',
    rolle: token.role,
    lokation,
    maaTaelle: token.role === 'admin' ? true : !!(token as any).lagerCanCount,
    maaPakke: token.role === 'admin' ? true : !!(token as any).lagerCanPack,
    lokationer,
    hylder,
  })
}
