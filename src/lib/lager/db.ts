// Lager-appens egne tabeller i portal-databasen. Selvoprettende, som resten af portalen:
// migrationer er ikke altid kørt på serveren, og appen må ikke dø på en manglende tabel
// klokken halv seks om morgenen.
//
// Her ligger KUN det BC ikke kan rumme: hvem der må scanne, hylderne, og hvad vi har
// modtaget én gang. Beholdning ligger i BC — altid.

import { prisma } from '@/lib/prisma'

let ensured = false

export async function ensureLagerSchema() {
  if (ensured) return
  await prisma.$executeRaw`
    CREATE TABLE IF NOT EXISTS "LagerUser" (
      "id"              TEXT    PRIMARY KEY,
      "name"            TEXT    NOT NULL,
      "initials"        TEXT,
      "pinHash"         TEXT    NOT NULL,
      "isActive"        BOOLEAN NOT NULL DEFAULT true,
      "defaultLocation" TEXT,
      "canCount"        BOOLEAN NOT NULL DEFAULT true,
      "canPack"         BOOLEAN NOT NULL DEFAULT false,
      "bcUserName"      TEXT,
      "createdAt"       TIMESTAMP NOT NULL DEFAULT NOW(),
      "updatedAt"       TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `
  await prisma.$executeRaw`
    CREATE TABLE IF NOT EXISTS "LagerShelf" (
      "id"           TEXT    PRIMARY KEY,
      "locationCode" TEXT    NOT NULL,
      "code"         TEXT    NOT NULL,
      "name"         TEXT    NOT NULL,
      "sortOrder"    INTEGER NOT NULL DEFAULT 0,
      "isActive"     BOOLEAN NOT NULL DEFAULT true,
      "createdAt"    TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `
  await prisma.$executeRaw`
    CREATE UNIQUE INDEX IF NOT EXISTS "LagerShelf_locationCode_code_key" ON "LagerShelf"("locationCode", "code")
  `
  await prisma.$executeRaw`
    CREATE TABLE IF NOT EXISTS "LagerIdempotency" (
      "key"       TEXT PRIMARY KEY,
      "endpoint"  TEXT NOT NULL,
      "userId"    TEXT,
      "result"    TEXT NOT NULL,
      "createdAt" TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `
  ensured = true
}

/**
 * Idempotens. Hver handling fra en håndterminal bærer en nøgle lavet PÅ ENHEDEN.
 * Kommer nøglen igen — dårligt wifi, genafspillet kø, dobbelttryk med en handske —
 * får appen det svar vi gav første gang, og handlingen udføres IKKE igen.
 *
 * Returnerer det gemte svar, eller null hvis nøglen er ny.
 */
export async function hentIdempotentSvar(key: string): Promise<any | null> {
  if (!key) return null
  await ensureLagerSchema()
  const rows = await prisma.$queryRaw<any[]>`
    SELECT result FROM "LagerIdempotency" WHERE key = ${key} LIMIT 1
  `
  if (!rows[0]) return null
  try {
    return JSON.parse(rows[0].result)
  } catch {
    return null
  }
}

export async function gemIdempotentSvar(
  key: string,
  endpoint: string,
  userId: string | null,
  result: unknown,
): Promise<void> {
  if (!key) return
  await ensureLagerSchema()
  // ON CONFLICT DO NOTHING: to terminaler (eller to forsøg) må ikke kunne vælte
  // hinanden — den første der nåede frem har svaret, og det er det der gælder.
  await prisma.$executeRaw`
    INSERT INTO "LagerIdempotency" ("key", "endpoint", "userId", "result")
    VALUES (${key}, ${endpoint}, ${userId}, ${JSON.stringify(result)})
    ON CONFLICT ("key") DO NOTHING
  `
}

export interface LagerShelf {
  id: string
  locationCode: string
  code: string
  name: string
  sortOrder: number
}

export async function hentHylder(locationCode: string): Promise<LagerShelf[]> {
  await ensureLagerSchema()
  return prisma.$queryRaw<LagerShelf[]>`
    SELECT id, "locationCode", code, name, "sortOrder"
    FROM "LagerShelf"
    WHERE "isActive" = true AND ("locationCode" = ${locationCode} OR ${locationCode} = '')
    ORDER BY "locationCode", "sortOrder", code
  `
}
