// Delt BC-cache for info-skærme.
//
// To formål:
//  1) 20 skærme der viser samme widget må kun koste ÉT kald til BC.
//  2) Falder BC (eller nettet) ud, serverer vi sidste gode svar videre med et
//     "opdateret kl."-stempel — skærmen sortner aldrig.

import { prisma } from '@/lib/prisma'
import { ensureSignageSchema } from './schema'
import { getWidget } from './widgets'

export interface WidgetPayload {
  widgetId:  string
  data:      unknown
  /** ISO-tidspunkt for hvornår data reelt blev hentet fra BC. */
  fetchedAt: string | null
  /** true = data er ældre end widgetens TTL (BC svarede ikke) eller mangler helt. */
  stale:     boolean
  error?:    string
}

/** Stabil nøgle — parametrene sorteres, så {a,b} og {b,a} deler cache-række. */
function cacheKey(widgetId: string, params: Record<string, number>): string {
  const sorted = Object.keys(params).sort().map(k => `${k}=${params[k]}`).join('&')
  return sorted ? `${widgetId}?${sorted}` : widgetId
}

// Samtidige kald i SAMME proces deles her, så et cache-miss med 20 skærme på
// linjen stadig kun bliver til ét BC-kald.
const inFlight = new Map<string, Promise<WidgetPayload>>()

export async function getWidgetData(
  widgetId: string,
  params: Record<string, number> = {},
): Promise<WidgetPayload> {
  const widget = getWidget(widgetId)
  if (!widget) {
    return { widgetId, data: null, fetchedAt: null, stale: true, error: 'Ukendt widget' }
  }

  await ensureSignageSchema()
  const key = cacheKey(widgetId, params)

  const rows = await prisma.$queryRaw<{ payload: string; fetchedAt: Date }[]>`
    SELECT payload, "fetchedAt" FROM "BcWidgetCache" WHERE key = ${key}
  `
  const row     = rows[0]
  const ageSec  = row ? (Date.now() - row.fetchedAt.getTime()) / 1000 : Infinity
  if (row && ageSec < widget.ttlSec) {
    return { widgetId, data: safeParse(row.payload), fetchedAt: row.fetchedAt.toISOString(), stale: false }
  }

  const pending = inFlight.get(key)
  if (pending) return pending

  const job = refresh(widget.id, params, key, row)
    .finally(() => inFlight.delete(key))
  inFlight.set(key, job)
  return job
}

async function refresh(
  widgetId: string,
  params:   Record<string, number>,
  key:      string,
  stale:    { payload: string; fetchedAt: Date } | undefined,
): Promise<WidgetPayload> {
  const widget = getWidget(widgetId)!
  try {
    const data      = await widget.fetch(params)
    const payload   = JSON.stringify(data)
    const fetchedAt = new Date()
    await prisma.$executeRaw`
      INSERT INTO "BcWidgetCache" (key, "widgetId", payload, "fetchedAt", "lastError", "lastErrorAt")
      VALUES (${key}, ${widgetId}, ${payload}, ${fetchedAt}, NULL, NULL)
      ON CONFLICT (key) DO UPDATE
        SET payload = EXCLUDED.payload,
            "fetchedAt" = EXCLUDED."fetchedAt",
            "lastError" = NULL,
            "lastErrorAt" = NULL
    `
    return { widgetId, data, fetchedAt: fetchedAt.toISOString(), stale: false }
  } catch (err) {
    const besked = err instanceof Error ? err.message : String(err)
    console.error(`[skaerm] widget ${widgetId} fejlede:`, besked)
    // Log fejlen, men rør IKKE payload/fetchedAt — de gode data skal blive stående.
    await prisma.$executeRaw`
      UPDATE "BcWidgetCache" SET "lastError" = ${besked.slice(0, 500)}, "lastErrorAt" = NOW()
      WHERE key = ${key}
    `.catch(() => {})

    if (stale) {
      return {
        widgetId,
        data:      safeParse(stale.payload),
        fetchedAt: stale.fetchedAt.toISOString(),
        stale:     true,
      }
    }
    return { widgetId, data: null, fetchedAt: null, stale: true, error: besked }
  }
}

function safeParse(s: string): unknown {
  try { return JSON.parse(s) } catch { return null }
}
