// Hvilken udgave af portalen serveren kører lige nu.
//
// Bruges af VersionVagt til at opdage at der er deployet mens kunden havde siden åben.
// Portalen ligger på mange telefoner som app fra hjemmeskærmen, og sådan en genindlæser
// ikke af sig selv — den kan køre uger gammel JavaScript mod et nyt API. Det så vi
// 2026-10-04: serveren svarede med det nye felt, og den gamle kode viste hele JSON-svaret
// til kunden.

import { NextResponse } from 'next/server'
import { readFileSync } from 'fs'
import { join } from 'path'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

let cachet: string | null = null

function byggeId(): string {
  // Læses én gang pr. proces — filen ændrer sig først ved næste deploy, og så er
  // processen genstartet.
  if (cachet) return cachet
  try {
    cachet = readFileSync(join(process.cwd(), '.next', 'BUILD_ID'), 'utf8').trim()
  } catch {
    cachet = 'ukendt'
  }
  return cachet
}

export async function GET() {
  return NextResponse.json({ build: byggeId() }, { headers: { 'Cache-Control': 'no-store' } })
}
