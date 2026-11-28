import { NextResponse } from 'next/server'
import { udlaegBrugerFraSession } from '@/lib/udlaeg'
import { aflaesKvittering } from '@/lib/udlaegAflaes'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(req: Request) {
  if (!(await udlaegBrugerFraSession())) return NextResponse.json({ fejl: 'Ingen adgang' }, { status: 403 })
  const { billeder } = await req.json().catch(() => ({ billeder: [] }))
  try {
    return NextResponse.json(await aflaesKvittering(Array.isArray(billeder) ? billeder : []))
  } catch (e: any) {
    // Aflæsningen er kun en hjælp — fejler den, udfylder medarbejderen selv.
    console.error('[bilag/aflaes]', e?.status ?? '', e?.message)
    return NextResponse.json({})
  }
}
