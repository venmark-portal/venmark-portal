// Medarbejdere: ÉT login pr. person med en eller flere "roller" (hatte) — admin, lager/pakker,
// chauffør, kunde (egen debitor) og hvad der kommer. Hver rolle peger på en række i den tabel
// rollen altid har brugt (AdminUser, LagerUser, DriverUser, Customer), så alt eksisterende
// (rettighedstjek på session.user.role og session.user.id) virker uændret: et rolleskift
// skriver bare den rolles bruger ind i login-tokenet, som om man havde logget ind som den.
//
// Ny rolle: tilføj den i ROLLER + en kolonne i "Medarbejder" + en gren i brugerForRolle.
//
// Chauffør- og lager-PIN virker som før. Er PIN-brugeren koblet til en medarbejder, får
// man rolleskiftet med (session.user.medarbejder).

import { prisma } from '@/lib/prisma'
import { ensureLagerSchema } from '@/lib/lager/db'

export type Rolle = 'admin' | 'lager' | 'chauffoer' | 'kunde'

export const ROLLER: { rolle: Rolle; navn: string; start: string; kolonne: string }[] = [
  { rolle: 'kunde',     navn: 'Kunde',         start: '/portal',    kolonne: 'customerId' },
  { rolle: 'lager',     navn: 'Lager/pakker',  start: '/lager',     kolonne: 'lagerUserId' },
  { rolle: 'admin',     navn: 'Admin',         start: '/admin',     kolonne: 'adminUserId' },
  { rolle: 'chauffoer', navn: 'Chauffør',      start: '/chauffeur', kolonne: 'driverUserId' },
]

export const rolleStart = (r: Rolle) => ROLLER.find(x => x.rolle === r)?.start ?? '/portal'

export interface Medarbejder {
  id:           string
  navn:         string
  email:        string
  passwordHash: string | null
  aktiv:        boolean
  adminUserId:  string | null
  lagerUserId:  string | null
  driverUserId: string | null
  customerId:   string | null
  sidsteRolle:  string | null
}

/** Rollerne medarbejderen har, i fast rækkefølge. */
export function roller(m: Medarbejder): Rolle[] {
  return ROLLER.filter(r => (m as any)[r.kolonne]).map(r => r.rolle)
}

let ensured: Promise<void> | null = null
export function ensureMedarbejderSkema(): Promise<void> {
  if (!ensured) ensured = (async () => {
    await prisma.$executeRaw`
      CREATE TABLE IF NOT EXISTS "Medarbejder" (
        id             TEXT PRIMARY KEY,
        navn           TEXT NOT NULL,
        email          TEXT NOT NULL UNIQUE,
        "passwordHash" TEXT,
        aktiv          BOOLEAN NOT NULL DEFAULT true,
        "adminUserId"  TEXT,
        "lagerUserId"  TEXT,
        "driverUserId" TEXT,
        "customerId"   TEXT,
        "sidsteRolle"  TEXT,
        "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT NOW(),
        "updatedAt"    TIMESTAMP(3) NOT NULL DEFAULT NOW()
      )
    `
  })().catch(err => { ensured = null; throw err })
  return ensured
}

export async function hentMedarbejder(id: string): Promise<Medarbejder | null> {
  await ensureMedarbejderSkema()
  const r = await prisma.$queryRaw<Medarbejder[]>`SELECT * FROM "Medarbejder" WHERE id = ${id} LIMIT 1`
  return r[0] ?? null
}

export async function medarbejderMedEmail(email: string): Promise<Medarbejder | null> {
  await ensureMedarbejderSkema()
  const r = await prisma.$queryRaw<Medarbejder[]>`SELECT * FROM "Medarbejder" WHERE email = ${email.trim().toLowerCase()} LIMIT 1`
  return r[0] ?? null
}

/** Medarbejderen bag en almindelig login-bruger (PIN, kunde- eller admin-login) — så
 *  rolleskiftet kommer med, uanset hvilken login-vej man brugte. */
export async function medarbejderForPinBruger(rolle: Rolle, id: string): Promise<Medarbejder | null> {
  if (!id) return null
  await ensureMedarbejderSkema()
  const r =
    rolle === 'lager' ? await prisma.$queryRaw<Medarbejder[]>`SELECT * FROM "Medarbejder" WHERE "lagerUserId" = ${id} AND aktiv = true LIMIT 1`
    : rolle === 'chauffoer' ? await prisma.$queryRaw<Medarbejder[]>`SELECT * FROM "Medarbejder" WHERE "driverUserId" = ${id} AND aktiv = true LIMIT 1`
    : rolle === 'admin' ? await prisma.$queryRaw<Medarbejder[]>`SELECT * FROM "Medarbejder" WHERE "adminUserId" = ${id} AND aktiv = true LIMIT 1`
    : await prisma.$queryRaw<Medarbejder[]>`SELECT * FROM "Medarbejder" WHERE "customerId" = ${id} AND aktiv = true LIMIT 1`
  return r[0] ?? null
}

/** next-auth-rolle → medarbejder-rolle. */
export function rolleFraRole(role: string | undefined): Rolle | null {
  return role === 'admin' ? 'admin' : role === 'lager' ? 'lager' : role === 'driver' ? 'chauffoer' : role === 'customer' ? 'kunde' : null
}

/** Det der lægges på login-brugeren, så sessionen kender medarbejderen og kan vise rolleskiftet. */
export function medarbejderFelter(m: Medarbejder, rolle: Rolle) {
  return { medarbejderId: m.id, medarbejderNavn: m.navn, medarbejderRoller: roller(m), medarbejderRolle: rolle }
}

// ── Brugeren for hver rolle — samme form som authorize() i auth.ts returnerer ──

export function kundeBruger(customer: any) {
  return {
    id:                    customer.id,
    email:                 customer.email,
    name:                  customer.name,
    role:                  'customer' as const,
    bcCustomerNumber:      customer.bcCustomerNumber,
    bcPriceGroup:          customer.bcPriceGroup ?? '',
    bcChainPriceGroup:     customer.bcChainPriceGroup ?? '',
    requirePoNumber:       customer.requirePoNumber,
    bcDebitorBookingGroup: customer.bcDebitorBookingGroup ?? '',
    isContact:             false,
  }
}

export function lagerBruger(u: any) {
  return {
    id:              u.id,
    name:            u.name,
    role:            'lager' as const,
    lagerInitials:   u.initials ?? '',
    lagerLocation:   u.defaultLocation ?? '',
    lagerCanCount:   !!u.canCount,
    lagerCanPack:    !!u.canPack,
    lagerBcUserName: u.bcUserName ?? '',
  }
}

/** Login-brugeren for en af medarbejderens roller — null hvis rollen ikke (længere) findes. */
export async function brugerForRolle(m: Medarbejder, rolle: Rolle): Promise<Record<string, any> | null> {
  if (!m.aktiv) return null
  let b: Record<string, any> | null = null
  if (rolle === 'admin' && m.adminUserId) {
    const a = await prisma.adminUser.findUnique({ where: { id: m.adminUserId } })
    if (a) b = { id: a.id, email: a.email, name: m.navn, role: 'admin' as const }
  } else if (rolle === 'kunde' && m.customerId) {
    const c = await prisma.customer.findUnique({ where: { id: m.customerId } })
    if (c && c.isActive && !(c as any).bcBlocked) b = kundeBruger(c)
  } else if (rolle === 'lager' && m.lagerUserId) {
    await ensureLagerSchema()
    const r = await prisma.$queryRaw<any[]>`
      SELECT id, name, initials, "defaultLocation", "canCount", "canPack", "bcUserName"
      FROM "LagerUser" WHERE id = ${m.lagerUserId} AND "isActive" = true LIMIT 1`
    if (r[0]) b = lagerBruger(r[0])
  } else if (rolle === 'chauffoer' && m.driverUserId) {
    const r = await prisma.$queryRaw<any[]>`
      SELECT id, name FROM "DriverUser" WHERE id = ${m.driverUserId} AND "isActive" = true LIMIT 1`
    if (r[0]) b = { id: r[0].id, name: r[0].name, role: 'driver' as const }
  }
  return b ? { ...b, ...medarbejderFelter(m, rolle) } : null
}

/** Standardrollen ved login: den man sidst brugte, ellers den første der virker. */
export async function startBruger(m: Medarbejder): Promise<Record<string, any> | null> {
  const mulige = roller(m)
  const foerst = m.sidsteRolle && mulige.includes(m.sidsteRolle as Rolle) ? [m.sidsteRolle as Rolle] : []
  for (const r of [...foerst, ...mulige.filter(x => !foerst.includes(x))]) {
    const b = await brugerForRolle(m, r)
    if (b) return b
  }
  return null
}

export async function huskRolle(id: string, rolle: Rolle): Promise<void> {
  await prisma.$executeRaw`UPDATE "Medarbejder" SET "sidsteRolle" = ${rolle}, "updatedAt" = NOW() WHERE id = ${id}`.catch(() => {})
}
