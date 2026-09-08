// Skema for info-skærme (digital signage) — fase 1.
//
// Serveren kører IKKE `prisma migrate` (jf. resten af kodebasen: tabeller sikres
// idempotent i koden, fx PodRecipient/DriverUser). Samme mønster her, så et
// `git pull && npm run build && pm2 restart` er nok til at få tabellerne op.
// Modellerne står også i prisma/schema.prisma som dokumentation.

import { prisma } from '@/lib/prisma'

let ensured: Promise<void> | null = null

async function run(): Promise<void> {
  // Én skærm = én række. `slides` er JSON (TEXT) i fase 1 — fase 2 flytter det
  // til rigtige Layout/Playlist/Slide-tabeller, og så bliver kolonnen droppet.
  await prisma.$executeRaw`
    CREATE TABLE IF NOT EXISTS "Screen" (
      id              TEXT PRIMARY KEY,
      name            TEXT NOT NULL,
      token           TEXT NOT NULL UNIQUE,
      orientation     TEXT NOT NULL DEFAULT 'landscape',
      slides          TEXT NOT NULL DEFAULT '[]',
      active          BOOLEAN NOT NULL DEFAULT true,
      "lastHeartbeat" TIMESTAMP(3),
      "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT NOW(),
      "updatedAt"     TIMESTAMP(3) NOT NULL DEFAULT NOW()
    )
  `

  // Delt cache pr. widget+parametre: ÉT hentekald deles af ALLE skærme, og
  // sidste gode svar bliver stående så et BC-nedbrud ikke sortner skærmene.
  await prisma.$executeRaw`
    CREATE TABLE IF NOT EXISTS "BcWidgetCache" (
      key           TEXT PRIMARY KEY,
      "widgetId"    TEXT NOT NULL,
      payload       TEXT NOT NULL,
      "fetchedAt"   TIMESTAMP(3) NOT NULL DEFAULT NOW(),
      "lastError"   TEXT,
      "lastErrorAt" TIMESTAMP(3)
    )
  `

  await prisma.$executeRaw`
    CREATE INDEX IF NOT EXISTS "Screen_active_idx" ON "Screen" (active)
  `

  // ── Grupper: tildel adgang (og senere indhold) pr. gruppe i stedet for pr. skærm ──
  await prisma.$executeRaw`
    CREATE TABLE IF NOT EXISTS "ScreenGroup" (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT NOW(),
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT NOW()
    )
  `
  await prisma.$executeRaw`ALTER TABLE "Screen" ADD COLUMN IF NOT EXISTS "groupId" TEXT`
  await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS "Screen_groupId_idx" ON "Screen" ("groupId")`

  // Layout: 'single' = én zone i fuld skærm · 'split' = BC øverst + slide-bånd i bunden.
  await prisma.$executeRaw`ALTER TABLE "Screen" ADD COLUMN IF NOT EXISTS layout TEXT NOT NULL DEFAULT 'single'`

  // ── Adgang pr. bruger × skærm ELLER gruppe ──────────────────────────────────
  await prisma.$executeRaw`
    CREATE TABLE IF NOT EXISTS "ScreenAccess" (
      id          TEXT PRIMARY KEY,
      "userId"    TEXT NOT NULL,
      "screenId"  TEXT,
      "groupId"   TEXT,
      role        TEXT NOT NULL DEFAULT 'editor',
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT NOW()
    )
  `
  await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS "ScreenAccess_userId_idx" ON "ScreenAccess" ("userId")`

  // Portal-admins har i forvejen adgang til kunder, ordrer og fakturaer, så de er
  // også signage-superadmins. Flaget her er til dem der KUN skal have skærme — fx
  // marketing: for dem gælder udelukkende det ScreenAccess giver.
  // Default false, så eksisterende admins er uændrede.
  await prisma.$executeRaw`ALTER TABLE "AdminUser" ADD COLUMN IF NOT EXISTS "signageLimited" BOOLEAN NOT NULL DEFAULT false`
}

/** Idempotent — DDL'en køres kun én gang pr. proces. */
export function ensureSignageSchema(): Promise<void> {
  if (!ensured) {
    ensured = run().catch(err => {
      ensured = null   // så næste kald prøver igen i stedet for at fejle for evigt
      throw err
    })
  }
  return ensured
}
