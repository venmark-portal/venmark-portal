import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { finansTidslinje, pakkeriTidslinje } from '@/lib/tidslinjer'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function dagStreng(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Copenhagen' }).format(d)
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if ((session?.user as any)?.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const nu  = new Date()
  const til = req.nextUrl.searchParams.get('til') ?? dagStreng(nu)
  const fra = req.nextUrl.searchParams.get('fra') ?? dagStreng(new Date(nu.getTime() - 29 * 864e5))
  const jobNr = req.nextUrl.searchParams.get('job') ?? '16'

  if (!/^\d{4}-\d{2}-\d{2}$/.test(fra) || !/^\d{4}-\d{2}-\d{2}$/.test(til)) {
    return NextResponse.json({ error: 'fra/til skal være YYYY-MM-DD' }, { status: 400 })
  }

  // De to sider af tavlen hentes uafhængigt: BC kan svare dårligt på den ene
  // uden at den anden skal gå ned med den.
  const [finans, pakkeri] = await Promise.all([
    finansTidslinje(fra, til).catch(e => ({ fejl: e instanceof Error ? e.message : String(e) })),
    pakkeriTidslinje(fra, til, jobNr).catch(e => ({ fejl: e instanceof Error ? e.message : String(e) })),
  ])

  return NextResponse.json({ fra, til, finans, pakkeri })
}
