// Skærme: opslag, oprettelse og heartbeat.
//
// Adgang: en skærm har ingen bruger-session — kun sit eget deviceToken i URL'en.
// Derfor kan en skærm aldrig se en anden skærms indhold eller kundedata, og et
// token der slipper ud giver kun adgang til netop den skærms visning.

import { createHash, randomBytes } from 'crypto'
import { prisma } from '@/lib/prisma'
import { ensureSignageSchema } from './schema'
import { getWidget, listWidgets } from './widgets'

export interface Slide {
  widgetId:    string
  params:      Record<string, number>
  durationSec: number
}

export interface Screen {
  id:            string
  name:          string
  token:         string
  orientation:   'landscape' | 'portrait'
  slides:        Slide[]
  active:        boolean
  lastHeartbeat: Date | null
  createdAt:     Date
  updatedAt:     Date
}

interface ScreenRow {
  id: string; name: string; token: string; orientation: string; slides: string
  active: boolean; lastHeartbeat: Date | null; createdAt: Date; updatedAt: Date
}

const MIN_DURATION = 5
const MAX_DURATION = 600

function mapRow(r: ScreenRow): Screen {
  return {
    id:            r.id,
    name:          r.name,
    token:         r.token,
    orientation:   r.orientation === 'portrait' ? 'portrait' : 'landscape',
    slides:        sanitizeSlides(safeParse(r.slides)),
    active:        Boolean(r.active),
    lastHeartbeat: r.lastHeartbeat,
    createdAt:     r.createdAt,
    updatedAt:     r.updatedAt,
  }
}

function safeParse(s: string): unknown {
  try { return JSON.parse(s) } catch { return [] }
}

/**
 * Kun kendte widgets slipper igennem, og parametrene klippes til de grænser
 * widgeten selv har defineret. En redaktør kan altså ikke smugle en anden
 * forespørgsel ind via slides-JSON.
 */
export function sanitizeSlides(input: unknown): Slide[] {
  if (!Array.isArray(input)) return []
  const out: Slide[] = []
  for (const raw of input) {
    if (!raw || typeof raw !== 'object') continue
    const widget = getWidget(String((raw as any).widgetId ?? ''))
    if (!widget) continue

    const params: Record<string, number> = {}
    const given = (raw as any).params ?? {}
    for (const def of widget.params) {
      const n = Number(given?.[def.key])
      params[def.key] = Number.isFinite(n)
        ? Math.min(def.max, Math.max(def.min, Math.round(n)))
        : def.default
    }

    const d = Number((raw as any).durationSec)
    out.push({
      widgetId:    widget.id,
      params,
      durationSec: Number.isFinite(d) ? Math.min(MAX_DURATION, Math.max(MIN_DURATION, Math.round(d))) : 20,
    })
  }
  return out
}

/** Standard-indhold på en ny skærm, så den viser noget med det samme. */
export function defaultSlides(): Slide[] {
  return listWidgets().map(w => ({
    widgetId:    w.id,
    params:      Object.fromEntries(w.params.map(p => [p.key, p.default])),
    durationSec: 20,
  }))
}

/**
 * Versions-hash af alt playeren skal reagere på. Beregnes ud fra rækken i
 * stedet for at ligge i en kolonne — så kan man ikke glemme at bumpe den.
 */
export function contentVersion(screen: Screen): string {
  const basis = JSON.stringify({
    name:        screen.name,
    orientation: screen.orientation,
    active:      screen.active,
    slides:      screen.slides,
  })
  return createHash('sha1').update(basis).digest('hex').slice(0, 12)
}

function newToken(): string {
  return randomBytes(16).toString('base64url')
}

// ─── Opslag ──────────────────────────────────────────────────────────────────

export async function getScreenByToken(token: string): Promise<Screen | null> {
  if (!token || token.length > 128) return null
  await ensureSignageSchema()
  const rows = await prisma.$queryRaw<ScreenRow[]>`
    SELECT id, name, token, orientation, slides, active, "lastHeartbeat", "createdAt", "updatedAt"
    FROM "Screen" WHERE token = ${token}
  `
  return rows[0] ? mapRow(rows[0]) : null
}

export async function listScreens(): Promise<Screen[]> {
  await ensureSignageSchema()
  const rows = await prisma.$queryRaw<ScreenRow[]>`
    SELECT id, name, token, orientation, slides, active, "lastHeartbeat", "createdAt", "updatedAt"
    FROM "Screen" ORDER BY name ASC
  `
  return rows.map(mapRow)
}

// ─── Skrivning ───────────────────────────────────────────────────────────────

export async function createScreen(
  name: string,
  orientation: 'landscape' | 'portrait' = 'landscape',
): Promise<Screen> {
  await ensureSignageSchema()
  const id     = randomBytes(12).toString('hex')
  const token  = newToken()
  const slides = JSON.stringify(defaultSlides())
  await prisma.$executeRaw`
    INSERT INTO "Screen" (id, name, token, orientation, slides, active)
    VALUES (${id}, ${name}, ${token}, ${orientation}, ${slides}, true)
  `
  const rows = await prisma.$queryRaw<ScreenRow[]>`
    SELECT id, name, token, orientation, slides, active, "lastHeartbeat", "createdAt", "updatedAt"
    FROM "Screen" WHERE id = ${id}
  `
  return mapRow(rows[0])
}

export async function updateScreen(
  id: string,
  patch: { name?: string; orientation?: 'landscape' | 'portrait'; active?: boolean; slides?: Slide[] },
): Promise<void> {
  await ensureSignageSchema()
  if (patch.name !== undefined) {
    await prisma.$executeRaw`UPDATE "Screen" SET name = ${patch.name}, "updatedAt" = NOW() WHERE id = ${id}`
  }
  if (patch.orientation !== undefined) {
    await prisma.$executeRaw`UPDATE "Screen" SET orientation = ${patch.orientation}, "updatedAt" = NOW() WHERE id = ${id}`
  }
  if (patch.active !== undefined) {
    await prisma.$executeRaw`UPDATE "Screen" SET active = ${patch.active}, "updatedAt" = NOW() WHERE id = ${id}`
  }
  if (patch.slides !== undefined) {
    const slides = JSON.stringify(sanitizeSlides(patch.slides))
    await prisma.$executeRaw`UPDATE "Screen" SET slides = ${slides}, "updatedAt" = NOW() WHERE id = ${id}`
  }
}

/** Nyt token — bruges hvis en skærm bortkommer eller URL'en er sluppet ud. */
export async function rotateToken(id: string): Promise<string> {
  await ensureSignageSchema()
  const token = newToken()
  await prisma.$executeRaw`UPDATE "Screen" SET token = ${token}, "updatedAt" = NOW() WHERE id = ${id}`
  return token
}

export async function deleteScreen(id: string): Promise<void> {
  await ensureSignageSchema()
  await prisma.$executeRaw`DELETE FROM "Screen" WHERE id = ${id}`
}

export async function touchHeartbeat(token: string): Promise<void> {
  await ensureSignageSchema()
  await prisma.$executeRaw`UPDATE "Screen" SET "lastHeartbeat" = NOW() WHERE token = ${token}`
}
