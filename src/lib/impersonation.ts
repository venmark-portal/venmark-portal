// "Gå ind som kunde" — admin åbner portalen med kundens egne øjne.
//
// Sikkerheden hviler på ÉN ting: billetten kan kun udstedes af en der allerede er
// logget ind som admin. Den rejser i en URL, og en URL havner i browserhistorik,
// serverlogs og chattråde — derfor:
//   • den lever i 2 minutter,
//   • den kan kun bruges én gang,
//   • den gemmes kun som hash, så en der læser databasen ikke kan bruge den,
//   • og hver udstedelse efterlader en række med hvem, hvilken kunde og hvornår.
//
// Billetten giver FULD kundeadgang, også til at afgive ordrer. Det er med vilje —
// pointen er at kunne hjælpe kunden hele vejen igennem — men derfor står der også
// et vedvarende bånd øverst på hver eneste side så længe man er inde som kunden.

import { randomBytes, createHash } from 'crypto'
import { prisma } from '@/lib/prisma'

/** Kort levetid: billetten skal bruges med det samme, ikke gemmes. */
const LEVETID_MS = 2 * 60 * 1000

let ensured: Promise<void> | null = null

async function run(): Promise<void> {
  await prisma.$executeRaw`
    CREATE TABLE IF NOT EXISTS "PortalImpersonation" (
      id           TEXT PRIMARY KEY,
      "tokenHash"  TEXT NOT NULL UNIQUE,
      "customerId" TEXT NOT NULL,
      "adminId"    TEXT NOT NULL,
      "adminEmail" TEXT NOT NULL,
      "adminName"  TEXT NOT NULL DEFAULT '',
      "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT NOW(),
      "expiresAt"  TIMESTAMP(3) NOT NULL,
      "usedAt"     TIMESTAMP(3)
    )
  `
}

export function ensureImpersonationSkema(): Promise<void> {
  if (!ensured) ensured = run().catch(err => { ensured = null; throw err })
  return ensured
}

function hash(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/**
 * Udsteder en billet. Kaldes KUN fra kode der allerede har bekræftet en admin-session.
 * Returnerer den rå billet — den findes ikke i databasen og kan ikke hentes igen.
 */
export async function udstedAdgang(
  admin: { id: string; email: string; name?: string | null },
  customerId: string,
): Promise<string> {
  await ensureImpersonationSkema()
  const token = randomBytes(32).toString('base64url')
  const udloeb = new Date(Date.now() + LEVETID_MS)
  await prisma.$executeRaw`
    INSERT INTO "PortalImpersonation" (id, "tokenHash", "customerId", "adminId", "adminEmail", "adminName", "expiresAt")
    VALUES (${randomBytes(16).toString('hex')}, ${hash(token)}, ${customerId}, ${admin.id}, ${admin.email}, ${admin.name ?? ''}, ${udloeb})
  `
  return token
}

export interface IndloestAdgang {
  customerId: string
  adminEmail: string
  adminName:  string
}

/**
 * Indløser en billet. Markerer den brugt i SAMME sætning som opslaget, så to
 * samtidige forsøg ikke begge kan slippe igennem — var det et opslag efterfulgt af
 * en opdatering, kunne en genindlæsning af siden nå at bruge den to gange.
 * Null = ukendt, udløbet eller allerede brugt. Vi skelner ikke udadtil; den der
 * prøver, skal ikke kunne høre forskel.
 */
export async function indloesAdgang(token: string): Promise<IndloestAdgang | null> {
  if (!token) return null
  await ensureImpersonationSkema()
  const rows = await prisma.$queryRaw<{ customerId: string; adminEmail: string; adminName: string }[]>`
    UPDATE "PortalImpersonation"
       SET "usedAt" = NOW()
     WHERE "tokenHash" = ${hash(token)}
       AND "usedAt" IS NULL
       AND "expiresAt" > NOW()
    RETURNING "customerId", "adminEmail", "adminName"
  `
  const r = rows[0]
  return r ? { customerId: r.customerId, adminEmail: r.adminEmail, adminName: r.adminName } : null
}
