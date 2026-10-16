// Indgangen fra BC's debitorkort: /admin/kunde-som/<debitornr>
//
// Adressen kan slås op direkte af et menneske med debitornummeret i hånden, og det er
// med vilje — det er dét der gør knappen i BC til én linje AL uden nøgler eller
// hemmeligheder. Sikkerheden ligger i at middlewaren kræver en admin-session på
// /admin/*: er man ikke logget ind, ryger man på admin-login og kommer tilbage hertil
// bagefter. Først dér udstedes den engangsbillet der rent faktisk åbner portalen.

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { udstedAdgang } from '@/lib/impersonation'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest, { params }: { params: { customerNo: string } }) {
  const session = await getServerSession(authOptions)
  const bruger = session?.user as any
  // Dobbelt bund under middlewaren: en rute må aldrig alene stole på at noget andet
  // har tjekket rollen.
  if (!bruger || bruger.role !== 'admin') {
    return omdirigér(`/admin/login?callbackUrl=${encodeURIComponent(`/admin/kunde-som/${params.customerNo}`)}`)
  }

  const nr = decodeURIComponent(params.customerNo ?? '').trim()
  if (!nr) return svarFejl(req, 'Der mangler et debitornummer i linket.')

  const kunde = await prisma.customer.findFirst({
    where:  { bcCustomerNumber: nr },
    select: { id: true, name: true },
  })
  if (!kunde) {
    return svarFejl(req, `Debitor ${nr} har ingen portalbruger. Opret kunden på portalen først.`)
  }

  const token = await udstedAdgang(
    { id: bruger.id, email: bruger.email ?? '', name: bruger.name },
    kunde.id,
  )
  return omdirigér(`/portal/som-kunde?token=${encodeURIComponent(token)}`)
}

/**
 * Videresend til en sti på SAMME sted — med en relativ adresse.
 *
 * `NextResponse.redirect(new URL(sti, req.url))` sender browseren til
 * `https://localhost:3000/...`: inde bag Caddy er `req.url` serverens egen
 * interne adresse, og en rute-handler normaliserer den ikke som middlewaren gør.
 * En relativ Location løses af browseren mod den adresse den selv kaldte, og kan
 * derfor ikke pege det forkerte sted hen.
 */
function omdirigér(sti: string): NextResponse {
  return new NextResponse(null, { status: 307, headers: { Location: sti } })
}

/** Fejl vises som en side, ikke som JSON — man kommer hertil ved at klikke i BC. */
function svarFejl(req: NextRequest, besked: string) {
  const html = `<!doctype html><html lang="da"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Kan ikke åbne som kunde</title>
<body style="font-family:system-ui,sans-serif;background:#f8fafc;margin:0;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:24px">
<div style="max-width:28rem;background:#fff;border:1px solid #e5e7eb;border-radius:16px;padding:24px">
<h1 style="margin:0 0 8px;font-size:17px;color:#b91c1c">Kan ikke åbne som kunde</h1>
<p style="margin:0 0 16px;font-size:15px;line-height:1.5;color:#374151">${besked}</p>
<a href="/admin/kunder" style="font-size:14px;color:#2563eb">Til kundelisten</a>
</div></body></html>`
  return new NextResponse(html, { status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8' } })
}
