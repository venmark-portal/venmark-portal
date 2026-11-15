import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { ensureLagerSchema } from '@/lib/lager/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// GET: navnene til login-listen. Må nås UDEN login — det er listen man vælger sig selv
// fra. Derfor kommer der kun navn og initialer med, aldrig PIN-hash eller rettigheder.
export async function GET() {
  await ensureLagerSchema()
  const rows = await prisma.$queryRaw<any[]>`
    SELECT id, name, initials FROM "LagerUser" WHERE "isActive" = true ORDER BY name
  `
  return NextResponse.json(rows.map(r => ({ id: r.id, name: r.name, initials: r.initials ?? '' })))
}
