// Print af hylde-labels fra håndterminalen.
//
// Labelen tegnes af BC (rapport 50650) og printes af BC til en PrintNode-printer.
// Portalen vælger kun HVILKEN printer. Det er med vilje: labelens layout findes ét
// sted, så en label printet ved hylden er den samme som en printet på kontoret.
//
// Hvorfor printeren sendes med hver gang: alle terminaler kalder BC ind som OAuth-appen,
// så BC's eget "min printer" pr. bruger rammer appen og ikke manden med terminalen.
// Valget hører til portalbrugeren og bor derfor her — og kan skiftes, når han flytter
// sted (Claus 22-11).

import { prisma } from '@/lib/prisma'
import { bcPortalBaseUrl, getAccessToken } from '@/lib/businesscentral'
import { ensureLagerSchema } from '@/lib/lager/db'

export interface Printer {
  id: string
  navn: string
  beskrivelse: string
}

let ensured = false

export async function ensurePrintSchema() {
  if (ensured) return
  await ensureLagerSchema()
  await prisma.$executeRaw`
    CREATE TABLE IF NOT EXISTS "LagerPrinterValg" (
      "brugerId"    TEXT PRIMARY KEY,
      "printerId"   TEXT NOT NULL,
      "printerNavn" TEXT NOT NULL DEFAULT '',
      "valgtAt"     TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `
  ensured = true
}

/**
 * Printerne BC kender. Listen kommer fra BC's eget printerregister, så den ikke kan
 * komme ud af trit: er en printer væk fra PrintNode, er den væk her.
 */
export async function hentPrintere(): Promise<Printer[]> {
  const token = await getAccessToken()
  const res = await fetch(`${bcPortalBaseUrl()}/printers?$orderby=name`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    cache: 'no-store',
  } as any)
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    console.error(`[lager print] GET printers fejlede ${res.status}: ${body}`)
    return []
  }
  const data = await res.json()
  return (data.value ?? []).map((p: any) => ({
    id: p.id ?? '',
    navn: p.name ?? '',
    beskrivelse: p.description ?? '',
  }))
}

export interface PrinterValg {
  printerId: string
  printerNavn: string
}

export async function hentValg(brugerId: string): Promise<PrinterValg | null> {
  await ensurePrintSchema()
  const rows = await prisma.$queryRaw<any[]>`
    SELECT "printerId", "printerNavn" FROM "LagerPrinterValg" WHERE "brugerId" = ${brugerId} LIMIT 1
  `
  if (!rows[0]) return null
  return { printerId: rows[0].printerId, printerNavn: rows[0].printerNavn ?? '' }
}

export async function gemValg(brugerId: string, printerId: string, printerNavn: string): Promise<void> {
  await ensurePrintSchema()
  await prisma.$executeRaw`
    INSERT INTO "LagerPrinterValg" ("brugerId", "printerId", "printerNavn", "valgtAt")
    VALUES (${brugerId}, ${printerId}, ${printerNavn}, NOW())
    ON CONFLICT ("brugerId")
    DO UPDATE SET "printerId" = ${printerId}, "printerNavn" = ${printerNavn}, "valgtAt" = NOW()
  `
}

/**
 * Printer labels for en eller flere varer.
 *
 * Flere varer i ÉT kald, ikke ét kald pr. vare: A4-katalogarket skal kunne fyldes af
 * flere varer, og ét print ad gangen ville give et ark pr. vare.
 *
 * Svaret er aldrig tavst. BC giver HTTP 200 med en fejltekst, når varen eller printeren
 * ikke findes — det er en besked til lagermanden, ikke en teknisk fejl. Kun når BC slet
 * ikke svarer, får vi null.
 */
export async function printLabels(
  itemNos: string[],
  antal: number,
  printerId: string,
  brugerNavn: string,
): Promise<{ ok: boolean; printet: number; printer: string; fejl?: string } | null> {
  const token = await getAccessToken()
  const t0 = Date.now()
  const res = await fetch(`${bcPortalBaseUrl()}/labelPrints`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      itemNos: itemNos.join(',').slice(0, 250),
      quantity: antal,
      printerId,
      printedBy: brugerNavn.slice(0, 100),
    }),
    cache: 'no-store',
  } as any)

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    console.error(`[lager print] POST labelPrints fejlede ${res.status}: ${body}`)
    return null
  }

  const row = await res.json()
  const fejl = String(row.errorText ?? '')
  console.log(
    `[lager print] ${itemNos.join(',')} × ${antal} → ${row.printerName || printerId} ` +
    `= ${row.printed ?? 0} labels (${Date.now() - t0} ms)${fejl ? ` FEJL: ${fejl}` : ''}`,
  )
  return {
    ok: !fejl && Number(row.printed ?? 0) > 0,
    printet: Number(row.printed ?? 0),
    printer: String(row.printerName ?? ''),
    fejl: fejl || undefined,
  }
}
