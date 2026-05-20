import { NextResponse } from 'next/server'
import { getAccessToken } from '@/lib/businesscentral'

export const dynamic = 'force-dynamic'

// Debug: vis raw itemAvailabilities fra BC
// Brug: /api/debug/avail
// Tilføj ?filter=stramtLager  for kun at se strengt lager
// Tilføj ?filter=blocked       for kun at se blokeringsfelter sat
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const filterMode = searchParams.get('filter') ?? ''

  const token   = await getAccessToken()
  const tenant  = process.env.BC_TENANT_ID!
  const env     = process.env.BC_ENVIRONMENT_NAME!
  const company = process.env.BC_COMPANY_ID!
  const base    = `https://api.businesscentral.dynamics.com/v2.0/${tenant}/${env}/api/venmark/portal/v1.0/companies(${company})`
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/json' }

  // Hent alle itemAvailabilities (max 1000 i første kald)
  const url = `${base}/itemAvailabilities?$top=1000`
  const res = await fetch(url, { headers, cache: 'no-store' } as any)
  const data = await res.json()

  if (!res.ok) {
    return NextResponse.json({ error: data, status: res.status })
  }

  const all: any[] = data.value ?? []

  // Find varer med særlige felter sat
  const withStrengt    = all.filter(i => i.strengtLager === true)
  const withTilgFra    = all.filter(i => i.tilgaengeligFra && i.tilgaengeligFra !== '0001-01-01')
  const withLukAfgang  = all.filter(i => i.lukAfgang === true)
  const withAabnTil    = all.filter(i => i.aabnTil && i.aabnTil !== 'PT0S' && i.aabnTil !== '')
  const withNaesteLev  = all.filter(i => i.naesteLevering && i.naesteLevering !== '0001-01-01')
  const withDisp0      = all.filter(i => (i.disponibelt ?? 0) <= 0)
  const withDispLow    = all.filter(i => (i.disponibelt ?? 99) < 50 && (i.disponibelt ?? 0) > 0)

  let filtered = all
  if (filterMode === 'strengtLager') filtered = withStrengt
  if (filterMode === 'blocked')      filtered = [...withTilgFra, ...withLukAfgang]

  return NextResponse.json({
    totalItems: all.length,
    hasNextLink: !!data['@odata.nextLink'],
    serverNow: new Date().toISOString(),
    summary: {
      strengtLager:    withStrengt.length,
      tilgaengeligFra: withTilgFra.length,
      lukAfgang:       withLukAfgang.length,
      aabnTil:         withAabnTil.length,
      naesteLevering:  withNaesteLev.length,
      disponibelt0:    withDisp0.length,
      disponibeltUnder50: withDispLow.length,
    },
    strengtLagerItems:    withStrengt.slice(0, 20),
    tilgaengeligFraItems: withTilgFra,
    lukAfgangItems:       withLukAfgang,
    aabnTilItems:         withAabnTil.slice(0, 10),
    naesteLeveringItems:  withNaesteLev,
    disponibelt0Items:    withDisp0.slice(0, 10),
    filter: filterMode || 'ingen (viser opsummering)',
    filteredSample: filterMode ? filtered.slice(0, 20) : 'sæt ?filter= for at se filtrerede varer',
  })
}
