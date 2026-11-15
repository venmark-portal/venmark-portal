/**
 * Opret eller ret en lagerbruger (login til /lager med navn + PIN).
 *
 *   node scripts/lager-bruger.mjs "Peter Hansen" 1234 [lokation] [initialer]
 *   node scripts/lager-bruger.mjs --liste
 *
 * Findes navnet allerede, sættes PIN'en om — så en glemt PIN er ét kald, ikke en sag.
 * Tabellerne oprettes af sig selv hvis de mangler (samme SQL som ensureLagerSchema).
 */
import { createRequire } from 'module'
const require = createRequire(import.meta.url)

const fs = require('fs')
const path = require('path')
const envFile = fs.readFileSync(path.join(process.cwd(), '.env.local'), 'utf8')
for (const line of envFile.split('\n')) {
  const m = line.match(/^([^#=]+)=(.*)$/)
  if (m) process.env[m[1].trim()] = m[2].trim().replace(/^['"]|['"]$/g, '')
}

const { PrismaClient } = require('@prisma/client')
const bcrypt = require('bcryptjs')
const prisma = new PrismaClient()

async function sikrSkema() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "LagerUser" (
      "id" TEXT PRIMARY KEY, "name" TEXT NOT NULL, "initials" TEXT, "pinHash" TEXT NOT NULL,
      "isActive" BOOLEAN NOT NULL DEFAULT true, "defaultLocation" TEXT,
      "canCount" BOOLEAN NOT NULL DEFAULT true, "canPack" BOOLEAN NOT NULL DEFAULT false,
      "bcUserName" TEXT, "createdAt" TIMESTAMP NOT NULL DEFAULT NOW(),
      "updatedAt" TIMESTAMP NOT NULL DEFAULT NOW())
  `)
}

async function main() {
  await sikrSkema()

  if (process.argv.includes('--liste')) {
    const rows = await prisma.$queryRawUnsafe(
      `SELECT name, initials, "defaultLocation", "canCount", "canPack", "isActive" FROM "LagerUser" ORDER BY name`,
    )
    console.log('── Lagerbrugere ──')
    for (const r of rows) {
      console.log(
        `  ${r.isActive ? '●' : '○'} ${String(r.name).padEnd(22)} ${String(r.initials ?? '').padEnd(5)} ` +
        `${String(r.defaultLocation ?? '').padEnd(12)} ${r.canCount ? 'tæller ' : '       '}${r.canPack ? 'pakker' : ''}`,
      )
    }
    return
  }

  const [navn, pin, lokation = '', initialer = ''] = process.argv.slice(2)
  if (!navn || !pin) {
    console.error('Brug: node scripts/lager-bruger.mjs "Navn" 1234 [lokation] [initialer]')
    process.exit(1)
  }
  if (!/^\d{4,8}$/.test(pin)) {
    console.error('PIN skal være 4-8 cifre')
    process.exit(1)
  }

  const hash = await bcrypt.hash(pin, 12)
  const fundet = await prisma.$queryRawUnsafe(`SELECT id FROM "LagerUser" WHERE name = $1 LIMIT 1`, navn)

  if (fundet[0]) {
    await prisma.$executeRawUnsafe(
      `UPDATE "LagerUser" SET "pinHash" = $1, "defaultLocation" = COALESCE(NULLIF($2,''), "defaultLocation"),
       initials = COALESCE(NULLIF($3,''), initials), "isActive" = true, "updatedAt" = NOW() WHERE id = $4`,
      hash, lokation, initialer, fundet[0].id,
    )
    console.log(`✓ PIN sat om for ${navn}`)
  } else {
    const id = `lager_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
    await prisma.$executeRawUnsafe(
      `INSERT INTO "LagerUser" (id, name, initials, "pinHash", "defaultLocation") VALUES ($1,$2,NULLIF($3,''),$4,NULLIF($5,''))`,
      id, navn, initialer, hash, lokation,
    )
    console.log(`✓ Oprettet ${navn}${lokation ? ` på ${lokation}` : ''}`)
  }
}

main()
  .catch(e => { console.error('FEJL:', e.message); process.exit(1) })
  .finally(() => prisma.$disconnect())
