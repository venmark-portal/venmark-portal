// Auktions-bud-motor: proxy-autobud (eBay-stil), min. spring, uafgjort→tidligste vinder,
// anti-snipe (+5 min), server-tid som lov, og samtidige bud serialiseret via FOR UPDATE-lås
// på auktionsrækken. Kun kreditgodkendte kunder må byde (tjekkes i API-ruten).

import { prisma } from '@/lib/prisma'

const ANTI_SNIPE_WINDOW_MS = 2 * 60 * 1000   // bud inden for 2 min før udløb…
const ANTI_SNIPE_EXTEND_MS = 5 * 60 * 1000   // …forlænger til nu + 5 min

export interface AuctionState {
  minPrice: number
  increment: number
  currentPrice: number
  leaderCustomerId: string | null
  leaderMax: number | null
}

export interface BidResolution {
  ok: boolean
  error?: string
  state: AuctionState
  loggedAmount: number          // synligt beløb der logges på Bid-rækken
  newLeader: boolean            // skiftede lederen?
  displacedLeaderId: string | null   // tidligere leder der blev overbudt (→ notifikation)
}

/**
 * Ren proxy-afgørelse. `newMax` = budgiverens maksimum (autobud-loft). Et "almindeligt" bud
 * er bare et proxy-bud hvor maks = det man taster. Vis-altid-bud: currentPrice = det synlige,
 * leaderMax holdes SKJULT.
 */
export function resolveBid(s: AuctionState, bidderId: string, newMax: number): BidResolution {
  const inc = s.increment
  const fail = (error: string): BidResolution =>
    ({ ok: false, error, state: s, loggedAmount: 0, newLeader: false, displacedLeaderId: null })

  if (!Number.isFinite(newMax) || newMax <= 0) return fail('Ugyldigt bud.')

  // Ingen bud endnu → første bud.
  if (!s.leaderCustomerId) {
    const minFirst = s.minPrice > 0 ? s.minPrice : inc
    if (newMax < minFirst) return fail(`Første bud skal være mindst ${minFirst} kr.`)
    return {
      ok: true,
      state: { ...s, currentPrice: minFirst, leaderCustomerId: bidderId, leaderMax: newMax },
      loggedAmount: minFirst, newLeader: true, displacedLeaderId: null,
    }
  }

  const leaderMax = s.leaderMax ?? s.currentPrice

  // Lederen hæver sit EGET maks (proxy-loft) — synlig pris uændret.
  if (bidderId === s.leaderCustomerId) {
    if (newMax <= leaderMax) return fail(`Du fører allerede. Nyt maks skal være over ${leaderMax} kr.`)
    return {
      ok: true,
      state: { ...s, leaderMax: newMax },
      loggedAmount: s.currentPrice, newLeader: false, displacedLeaderId: null,
    }
  }

  // Udfordrer.
  const minNext = s.currentPrice + inc
  if (newMax < minNext) return fail(`Buddet skal være mindst ${minNext} kr.`)

  if (newMax > leaderMax) {
    // Udfordrer vinder. Ny pris = gammelt lederloft + spring (cappet ved udfordrers maks).
    const price = Math.min(newMax, leaderMax + inc)
    return {
      ok: true,
      state: { ...s, currentPrice: price, leaderCustomerId: bidderId, leaderMax: newMax },
      loggedAmount: price, newLeader: true, displacedLeaderId: s.leaderCustomerId,
    }
  }

  // newMax <= leaderMax: lederen holder (uafgjort → TIDLIGSTE bud vinder = nuværende leder).
  // Prisen stiger, men lederen er uændret; udfordreren blev straks overbudt.
  const price = newMax === leaderMax ? newMax : Math.min(leaderMax, newMax + inc)
  return {
    ok: true,
    state: { ...s, currentPrice: price },
    loggedAmount: price, newLeader: false, displacedLeaderId: null,
  }
}

export interface PlaceBidResult {
  ok: boolean
  error?: string
  leading?: boolean
  currentPrice?: number
  endsAt?: Date
}

/** Læg et bud i en transaktion med FOR UPDATE-lås → samtidige bud serialiseres. */
export async function placeBid(
  auctionId: string,
  bidder: { id: string; name: string },
  newMax: number,
): Promise<PlaceBidResult> {
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Array<{
      id: string; title: string; status: string; endsAt: Date;
      minPrice: string; minIncrement: string; currentPrice: string;
      leaderCustomerId: string | null; leaderMax: string | null;
    }>>`
      SELECT id, title, status, "endsAt", "minPrice", "minIncrement",
             "currentPrice", "leaderCustomerId", "leaderMax"
      FROM "Auction" WHERE id = ${auctionId} FOR UPDATE`

    const a = rows[0]
    if (!a) return { ok: false, error: 'Auktionen findes ikke.' }
    const now = new Date()
    if (a.status !== 'LIVE') return { ok: false, error: 'Auktionen er ikke i gang.' }
    if (now >= new Date(a.endsAt)) return { ok: false, error: 'Auktionen er udløbet.' }

    const s: AuctionState = {
      minPrice: Number(a.minPrice),
      increment: Number(a.minIncrement),
      currentPrice: Number(a.currentPrice),
      leaderCustomerId: a.leaderCustomerId,
      leaderMax: a.leaderMax == null ? null : Number(a.leaderMax),
    }

    const r = resolveBid(s, bidder.id, newMax)
    if (!r.ok) return { ok: false, error: r.error }

    // Anti-snipe: bud inden for 2 min før udløb → forlæng til nu + 5 min.
    const endsAtCur = new Date(a.endsAt)
    const endsAt = (endsAtCur.getTime() - now.getTime() < ANTI_SNIPE_WINDOW_MS)
      ? new Date(now.getTime() + ANTI_SNIPE_EXTEND_MS)
      : endsAtCur

    await tx.auction.update({
      where: { id: auctionId },
      data: {
        currentPrice: r.state.currentPrice,
        leaderCustomerId: r.state.leaderCustomerId,
        leaderName: r.newLeader ? bidder.name : undefined,   // kun ved lederskifte
        leaderMax: r.state.leaderMax,
        bidCount: { increment: 1 },
        endsAt,
      },
    })

    await tx.bid.create({
      data: {
        auctionId, customerId: bidder.id, bidderName: bidder.name,
        amount: r.loggedAmount, maxAmount: newMax,
      },
    })

    // Notifikation i portalen til den der blev overbudt (Message → beskedcenter).
    if (r.displacedLeaderId) {
      await tx.message.create({
        data: {
          customerId: r.displacedLeaderId,
          sender: 'admin', senderName: 'Auktion',
          body: `Du er blevet overbudt på "${a.title}". Nuværende bud: ${r.state.currentPrice} kr. Byd igen for at føre.`,
          readByAdmin: true, readByCustomer: false,
          expiresAt: new Date(Date.now() + 30 * 24 * 3600 * 1000),
        },
      })
    }

    return {
      ok: true,
      leading: r.state.leaderCustomerId === bidder.id,
      currentPrice: r.state.currentPrice,
      endsAt,
    }
  })
}

/** Offentlig visning af en auktion (leaderMax eksponeres ALDRIG). */
export function publicState(a: {
  id: string; status: string; endsAt: Date | string;
  minPrice: unknown; minIncrement: unknown; currentPrice: unknown;
  leaderCustomerId: string | null; leaderName: string | null; bidCount: number;
}, viewerCustomerId: string | null) {
  const inc = Number(a.minIncrement)
  const price = Number(a.currentPrice)
  const min = Number(a.minPrice)
  const ended = a.status !== 'LIVE' || new Date(a.endsAt).getTime() <= Date.now()
  return {
    id: a.id,
    status: a.status,
    currentPrice: price,
    bidCount: a.bidCount,
    minNext: a.leaderCustomerId ? price + inc : (min > 0 ? min : inc),
    endsAt: a.endsAt,
    ended,
    leaderName: a.leaderName,
    youLead: !!viewerCustomerId && a.leaderCustomerId === viewerCustomerId,
  }
}
