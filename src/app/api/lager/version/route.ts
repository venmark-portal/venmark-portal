import { NextResponse } from 'next/server'
import { readFileSync } from 'fs'
import { join } from 'path'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Hvilken udgave af appen serveren kører lige nu.
//
// En håndterminal eller en telefon holder fast i den side den allerede har hentet,
// og så står folk og tester en version der ikke findes mere. Appen spørger her, og
// opdager den at nummeret er skiftet, tilbyder den at hente den nye.
//
// Next skriver sit build-id til .next/BUILD_ID ved hvert byggeri — det er det
// nærmeste vi har på et versionsnummer uden at skulle vedligeholde et.
let cachet = ''

function buildId(): string {
  if (cachet) return cachet
  for (const mappe of ['.next', '.next-new']) {
    try {
      cachet = readFileSync(join(process.cwd(), mappe, 'BUILD_ID'), 'utf8').trim()
      if (cachet) return cachet
    } catch {
      /* prøv næste */
    }
  }
  // Falder alt andet væk: serverens starttidspunkt. Det skifter også ved deploy.
  cachet = String(Math.floor(Date.now() / 1000 - process.uptime()))
  return cachet
}

export async function GET() {
  return NextResponse.json(
    { version: buildId() },
    { headers: { 'Cache-Control': 'no-store, must-revalidate' } },
  )
}
