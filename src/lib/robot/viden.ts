// Robot-viden: det robotten ved om Venmark, og som den ikke kan slå op (kontakt, fragt,
// reklamation, "Bakka = Bakkafrost fra Færøerne" …). Redigeres af kontoret under
// /admin/robot/viden og læses ind i robottens instruks ved hvert spørgsmål.
//
// Første gang tabellen oprettes, fyldes den med afsnittene fra content/kundeservice-faq.md.
// Derefter er databasen den eneste kilde — filen bruges kun, hvis databasen svigter.

import { readFile } from 'fs/promises'
import path from 'path'
import { prisma } from '@/lib/prisma'

export interface VidenPunkt {
  id: number; emne: string; tekst: string; aktiv: boolean; kilde: string
  oprettetAf: string | null; createdAt: Date; updatedAt: Date
}

let ensured: Promise<void> | null = null

async function faqFil(): Promise<string> {
  const raa = await readFile(path.join(process.cwd(), 'content', 'kundeservice-faq.md'), 'utf8').catch(() => '')
  return raa.replace(/<!--[\s\S]*?-->/g, '').trim()
}

async function run(): Promise<void> {
  await prisma.$executeRaw`
    CREATE TABLE IF NOT EXISTS "RobotViden" (
      id            SERIAL PRIMARY KEY,
      emne          TEXT NOT NULL,
      tekst         TEXT NOT NULL,
      aktiv         BOOLEAN NOT NULL DEFAULT true,
      kilde         TEXT NOT NULL DEFAULT 'manuel',
      "beskedId"    BIGINT,
      "oprettetAf"  TEXT,
      "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT NOW(),
      "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT NOW()
    )
  `
  const [{ n }] = await prisma.$queryRaw<{ n: bigint }[]>`SELECT COUNT(*) AS n FROM "RobotViden"`
  if (Number(n) > 0) return
  // Frø: ét punkt pr. "## afsnit" i FAQ-filen.
  const faq = await faqFil()
  for (const blok of faq.split(/^## /m).slice(1)) {
    const [hoved, ...rest] = blok.split('\n')
    const tekst = rest.join('\n').trim()
    if (hoved.trim() && tekst) {
      await prisma.$executeRaw`
        INSERT INTO "RobotViden" (emne, tekst, kilde, "oprettetAf") VALUES (${hoved.trim()}, ${tekst}, 'faq-fil', 'import')
      `
    }
  }
}

export function ensureVidenSkema(): Promise<void> {
  if (!ensured) ensured = run().catch(err => { ensured = null; throw err })
  return ensured
}

export async function hentViden(kunAktive = false): Promise<VidenPunkt[]> {
  await ensureVidenSkema()
  const rows = await prisma.$queryRaw<VidenPunkt[]>`
    SELECT id, emne, tekst, aktiv, kilde, "oprettetAf", "createdAt", "updatedAt"
    FROM "RobotViden" ORDER BY id
  `
  return kunAktive ? rows.filter(r => r.aktiv) : rows
}

let promptCache: { tekst: string; t: number } | null = null

/** Den viden der står i robottens instruks. Huskes ét minut; ændringer i admin rydder den. */
export async function videnTilPrompt(): Promise<string> {
  if (promptCache && Date.now() - promptCache.t < 60_000) return promptCache.tekst
  let tekst: string
  try {
    const punkter = await hentViden(true)
    tekst = punkter.map(p => `## ${p.emne}\n${p.tekst}`).join('\n\n')
  } catch (err) {
    console.error('[robot] Robot-viden kunne ikke læses — bruger FAQ-filen', err)
    tekst = await faqFil()
  }
  promptCache = { tekst, t: Date.now() }
  return tekst
}

export function rydVidenCache() { promptCache = null }

export async function gemVidenPunkt(p: { id?: number; emne: string; tekst: string; aktiv?: boolean; kilde?: string; beskedId?: number | null; af: string }) {
  await ensureVidenSkema()
  if (p.id) {
    await prisma.$executeRaw`
      UPDATE "RobotViden" SET emne = ${p.emne}, tekst = ${p.tekst}, aktiv = ${p.aktiv ?? true}, "updatedAt" = NOW()
      WHERE id = ${p.id}
    `
  } else {
    await prisma.$executeRaw`
      INSERT INTO "RobotViden" (emne, tekst, aktiv, kilde, "beskedId", "oprettetAf")
      VALUES (${p.emne}, ${p.tekst}, ${p.aktiv ?? true}, ${p.kilde ?? 'manuel'}, ${p.beskedId ?? null}, ${p.af})
    `
  }
  rydVidenCache()
}

export async function sletVidenPunkt(id: number) {
  await ensureVidenSkema()
  await prisma.$executeRaw`DELETE FROM "RobotViden" WHERE id = ${id}`
  rydVidenCache()
}
