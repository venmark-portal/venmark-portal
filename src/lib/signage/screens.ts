// Skærme, grupper, tidsplan og adgang.
//
// Adgang: en skærm har ingen bruger-session — kun sit eget deviceToken i URL'en.
// Derfor kan en skærm aldrig se en anden skærms indhold eller kundedata, og et
// token der slipper ud giver kun adgang til netop den skærms visning.

import { createHash, randomBytes } from 'crypto'
import { prisma } from '@/lib/prisma'
import { ensureSignageSchema } from './schema'
import { getWidget, listWidgets } from './widgets'

// ─── Typer ───────────────────────────────────────────────────────────────────

export type Zone = 'main' | 'ticker'
export type Layout = 'single' | 'split'
export type SignageRole = 'viewer' | 'editor' | 'admin'

export interface SlideSchedule {
  /** YYYY-MM-DD — tom = ingen grænse */
  from?:     string
  to?:       string
  /** HH:MM i dansk tid. timeFrom > timeTo = vindue hen over midnat. */
  timeFrom?: string
  timeTo?:   string
  /** 1=mandag … 7=søndag. Tom = alle dage. */
  weekdays?: number[]
}

export interface Slide {
  widgetId:    string
  params:      Record<string, number>
  durationSec: number
  zone:        Zone
  schedule?:   SlideSchedule
}

export interface Screen {
  id:            string
  name:          string
  token:         string
  orientation:   'landscape' | 'portrait'
  layout:        Layout
  groupId:       string | null
  slides:        Slide[]
  active:        boolean
  lastHeartbeat: Date | null
  createdAt:     Date
  updatedAt:     Date
}

export interface ScreenGroup {
  id:   string
  name: string
}

export interface AccessRow {
  id:       string
  userId:   string
  screenId: string | null
  groupId:  string | null
  role:     SignageRole
}

interface ScreenRow {
  id: string; name: string; token: string; orientation: string; layout: string
  groupId: string | null; slides: string; active: boolean
  lastHeartbeat: Date | null; createdAt: Date; updatedAt: Date
}

const MIN_DURATION = 5
const MAX_DURATION = 600

// ─── Dansk tid ───────────────────────────────────────────────────────────────

export interface LocalNow { ymd: string; hhmm: string; weekday: number }

/** Dato, klokkeslæt og ugedag i Europe/Copenhagen — tidsplanen er dansk tid. */
export function copenhagenNow(now: Date = new Date()): LocalNow {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone:  'Europe/Copenhagen',
    hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', weekday: 'short',
  }).formatToParts(now)
  const p: Record<string, string> = {}
  for (const part of parts) p[part.type] = part.value
  const uge: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 }
  return {
    ymd:     `${p.year}-${p.month}-${p.day}`,
    hhmm:    `${p.hour}:${p.minute}`,
    weekday: uge[p.weekday] ?? 1,
  }
}

/** Er slidet planlagt til at køre lige nu? */
export function slideIsActive(slide: Slide, t: LocalNow = copenhagenNow()): boolean {
  const s = slide.schedule
  if (!s) return true
  if (s.from && t.ymd < s.from) return false
  if (s.to   && t.ymd > s.to)   return false
  if (s.weekdays && s.weekdays.length > 0 && !s.weekdays.includes(t.weekday)) return false

  if (s.timeFrom && s.timeTo) {
    if (s.timeFrom <= s.timeTo) {
      if (t.hhmm < s.timeFrom || t.hhmm >= s.timeTo) return false
    } else {
      // Vindue hen over midnat, fx 22:00–06:00.
      if (t.hhmm < s.timeFrom && t.hhmm >= s.timeTo) return false
    }
  } else if (s.timeFrom && t.hhmm < s.timeFrom) return false
  else if (s.timeTo && t.hhmm >= s.timeTo) return false

  return true
}

/** De slides der skal vises lige nu — det er dem playeren får. */
export function activeSlides(screen: Screen, t: LocalNow = copenhagenNow()): Slide[] {
  return screen.slides.filter(s => slideIsActive(s, t))
}

// ─── Kortlægning + validering ────────────────────────────────────────────────

function mapRow(r: ScreenRow): Screen {
  return {
    id:            r.id,
    name:          r.name,
    token:         r.token,
    orientation:   r.orientation === 'portrait' ? 'portrait' : 'landscape',
    layout:        r.layout === 'split' ? 'split' : 'single',
    groupId:       r.groupId,
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

const YMD  = /^\d{4}-\d{2}-\d{2}$/
const HHMM = /^\d{2}:\d{2}$/

function sanitizeSchedule(raw: any): SlideSchedule | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const s: SlideSchedule = {}
  if (YMD.test(String(raw.from ?? '')))      s.from     = String(raw.from)
  if (YMD.test(String(raw.to   ?? '')))      s.to       = String(raw.to)
  if (HHMM.test(String(raw.timeFrom ?? ''))) s.timeFrom = String(raw.timeFrom)
  if (HHMM.test(String(raw.timeTo   ?? ''))) s.timeTo   = String(raw.timeTo)
  if (Array.isArray(raw.weekdays)) {
    const d: number[] = Array.from(new Set(
      raw.weekdays.map(Number).filter((n: number) => Number.isInteger(n) && n >= 1 && n <= 7),
    ))
    // 7 ud af 7 dage er det samme som ingen begrænsning — gem det ikke.
    if (d.length > 0 && d.length < 7) s.weekdays = d.sort()
  }
  return Object.keys(s).length > 0 ? s : undefined
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
      zone:        (raw as any).zone === 'ticker' ? 'ticker' : 'main',
      schedule:    sanitizeSchedule((raw as any).schedule),
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
    zone:        'main' as Zone,
  }))
}

/**
 * Versions-hash af alt playeren skal reagere på — beregnet ud fra de slides der
 * er AKTIVE lige nu. Derfor skifter hashen af sig selv når et tidsplanlagt slide
 * går ind eller ud, og playeren henter forfra ved næste manifest-poll. Ingen
 * baggrundsjob nødvendigt.
 */
export function contentVersion(screen: Screen, t: LocalNow = copenhagenNow()): string {
  const basis = JSON.stringify({
    name:        screen.name,
    orientation: screen.orientation,
    layout:      screen.layout,
    active:      screen.active,
    slides:      activeSlides(screen, t),
  })
  return createHash('sha1').update(basis).digest('hex').slice(0, 12)
}

function newToken(): string {
  return randomBytes(16).toString('base64url')
}

const SELECT = `id, name, token, orientation, layout, "groupId", slides, active, "lastHeartbeat", "createdAt", "updatedAt"`

// ─── Skærme ──────────────────────────────────────────────────────────────────

export async function getScreenByToken(token: string): Promise<Screen | null> {
  if (!token || token.length > 128) return null
  await ensureSignageSchema()
  const rows = await prisma.$queryRawUnsafe<ScreenRow[]>(
    `SELECT ${SELECT} FROM "Screen" WHERE token = $1`, token,
  )
  return rows[0] ? mapRow(rows[0]) : null
}

export async function getScreen(id: string): Promise<Screen | null> {
  await ensureSignageSchema()
  const rows = await prisma.$queryRawUnsafe<ScreenRow[]>(
    `SELECT ${SELECT} FROM "Screen" WHERE id = $1`, id,
  )
  return rows[0] ? mapRow(rows[0]) : null
}

export async function listScreens(): Promise<Screen[]> {
  await ensureSignageSchema()
  const rows = await prisma.$queryRawUnsafe<ScreenRow[]>(
    `SELECT ${SELECT} FROM "Screen" ORDER BY name ASC`,
  )
  return rows.map(mapRow)
}

export async function createScreen(
  name: string,
  orientation: 'landscape' | 'portrait' = 'landscape',
  groupId: string | null = null,
  layout: Layout = 'single',
): Promise<Screen> {
  await ensureSignageSchema()
  const id     = randomBytes(12).toString('hex')
  const token  = newToken()
  const slides = JSON.stringify(defaultSlides())
  await prisma.$executeRaw`
    INSERT INTO "Screen" (id, name, token, orientation, layout, "groupId", slides, active)
    VALUES (${id}, ${name}, ${token}, ${orientation}, ${layout}, ${groupId}, ${slides}, true)
  `
  return (await getScreen(id))!
}

export async function updateScreen(
  id: string,
  patch: {
    name?: string; orientation?: 'landscape' | 'portrait'; active?: boolean
    slides?: Slide[]; layout?: Layout; groupId?: string | null
  },
): Promise<void> {
  await ensureSignageSchema()
  if (patch.name !== undefined)
    await prisma.$executeRaw`UPDATE "Screen" SET name = ${patch.name}, "updatedAt" = NOW() WHERE id = ${id}`
  if (patch.orientation !== undefined)
    await prisma.$executeRaw`UPDATE "Screen" SET orientation = ${patch.orientation}, "updatedAt" = NOW() WHERE id = ${id}`
  if (patch.layout !== undefined)
    await prisma.$executeRaw`UPDATE "Screen" SET layout = ${patch.layout}, "updatedAt" = NOW() WHERE id = ${id}`
  if (patch.groupId !== undefined)
    await prisma.$executeRaw`UPDATE "Screen" SET "groupId" = ${patch.groupId}, "updatedAt" = NOW() WHERE id = ${id}`
  if (patch.active !== undefined)
    await prisma.$executeRaw`UPDATE "Screen" SET active = ${patch.active}, "updatedAt" = NOW() WHERE id = ${id}`
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
  await prisma.$executeRaw`DELETE FROM "ScreenAccess" WHERE "screenId" = ${id}`
  await prisma.$executeRaw`DELETE FROM "Screen" WHERE id = ${id}`
}

export async function touchHeartbeat(token: string): Promise<void> {
  await ensureSignageSchema()
  await prisma.$executeRaw`UPDATE "Screen" SET "lastHeartbeat" = NOW() WHERE token = ${token}`
}

// ─── Grupper ─────────────────────────────────────────────────────────────────

export async function listGroups(): Promise<ScreenGroup[]> {
  await ensureSignageSchema()
  return prisma.$queryRaw<ScreenGroup[]>`SELECT id, name FROM "ScreenGroup" ORDER BY name ASC`
}

export async function createGroup(name: string): Promise<ScreenGroup> {
  await ensureSignageSchema()
  const id = randomBytes(12).toString('hex')
  await prisma.$executeRaw`INSERT INTO "ScreenGroup" (id, name) VALUES (${id}, ${name})`
  return { id, name }
}

export async function renameGroup(id: string, name: string): Promise<void> {
  await ensureSignageSchema()
  await prisma.$executeRaw`UPDATE "ScreenGroup" SET name = ${name}, "updatedAt" = NOW() WHERE id = ${id}`
}

export async function deleteGroup(id: string): Promise<void> {
  await ensureSignageSchema()
  // Skærmene overlever — de mister bare deres gruppe.
  await prisma.$executeRaw`UPDATE "Screen" SET "groupId" = NULL WHERE "groupId" = ${id}`
  await prisma.$executeRaw`DELETE FROM "ScreenAccess" WHERE "groupId" = ${id}`
  await prisma.$executeRaw`DELETE FROM "ScreenGroup" WHERE id = ${id}`
}

// ─── Adgang ──────────────────────────────────────────────────────────────────

const RANG: Record<SignageRole, number> = { viewer: 1, editor: 2, admin: 3 }

export interface AccessListRow extends AccessRow {
  userName:  string
  userEmail: string
}

export async function listAccess(): Promise<AccessListRow[]> {
  await ensureSignageSchema()
  return prisma.$queryRaw<AccessListRow[]>`
    SELECT a.id, a."userId", a."screenId", a."groupId", a.role,
           u.name AS "userName", u.email AS "userEmail"
    FROM "ScreenAccess" a
    JOIN "AdminUser" u ON u.id = a."userId"
    ORDER BY u.name ASC
  `
}

export async function accessForUser(userId: string): Promise<AccessRow[]> {
  await ensureSignageSchema()
  return prisma.$queryRaw<AccessRow[]>`
    SELECT id, "userId", "screenId", "groupId", role FROM "ScreenAccess" WHERE "userId" = ${userId}
  `
}

export async function grantAccess(
  userId: string, target: { screenId?: string | null; groupId?: string | null }, role: SignageRole,
): Promise<void> {
  await ensureSignageSchema()
  const id = randomBytes(12).toString('hex')
  await prisma.$executeRaw`
    INSERT INTO "ScreenAccess" (id, "userId", "screenId", "groupId", role)
    VALUES (${id}, ${userId}, ${target.screenId ?? null}, ${target.groupId ?? null}, ${role})
  `
}

export async function revokeAccess(id: string): Promise<void> {
  await ensureSignageSchema()
  await prisma.$executeRaw`DELETE FROM "ScreenAccess" WHERE id = ${id}`
}

export interface AdminBruger {
  id: string; name: string; email: string; signageLimited: boolean
}

export async function listAdminUsers(): Promise<AdminBruger[]> {
  await ensureSignageSchema()
  return prisma.$queryRaw<AdminBruger[]>`
    SELECT id, name, email, "signageLimited" FROM "AdminUser" ORDER BY name ASC
  `
}

export async function setSignageLimited(userId: string, limited: boolean): Promise<void> {
  await ensureSignageSchema()
  await prisma.$executeRaw`UPDATE "AdminUser" SET "signageLimited" = ${limited} WHERE id = ${userId}`
}

/** Er brugeren begrænset til det ScreenAccess giver, eller er hun signage-superadmin? */
export async function isLimitedUser(userId: string): Promise<boolean> {
  await ensureSignageSchema()
  const rows = await prisma.$queryRaw<{ signageLimited: boolean }[]>`
    SELECT "signageLimited" FROM "AdminUser" WHERE id = ${userId}
  `
  return Boolean(rows[0]?.signageLimited)
}

/**
 * Brugerens rolle på én skærm. Ubegrænsede portal-admins er admin overalt — de
 * har i forvejen adgang til kunder, ordrer og fakturaer, så det ville være
 * teater at spærre dem ude fra skærmene.
 */
export function roleForScreen(screen: Screen, rows: AccessRow[], limited: boolean): SignageRole | null {
  if (!limited) return 'admin'
  let best: SignageRole | null = null
  for (const r of rows) {
    const rammer = (r.screenId !== null && r.screenId === screen.id) ||
                   (r.groupId  !== null && screen.groupId !== null && r.groupId === screen.groupId)
    if (!rammer) continue
    if (!best || RANG[r.role] > RANG[best]) best = r.role
  }
  return best
}

export function mindstRolle(role: SignageRole | null, kraevet: SignageRole): boolean {
  return role !== null && RANG[role] >= RANG[kraevet]
}
