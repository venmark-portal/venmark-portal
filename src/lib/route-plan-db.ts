// Server-side del af ruteplanlægningen: skema-sikring, opslag og automatisk rute.
import { randomUUID } from 'crypto'
import { prisma } from '@/lib/prisma'
import { getSalesOrdersForDelivery } from '@/lib/businesscentral'
import { buildAutoPlan, type ProfileMap } from '@/lib/route-plan'

/** Kolonner/tabeller der styres med rå SQL (bevidst uden for schema.prisma — se CLAUDE.md). */
export async function ensureRouteSchema() {
  await prisma.$executeRaw`ALTER TABLE "DeliveryCode" ADD COLUMN IF NOT EXISTS "ownRoute" BOOLEAN`
  // Standard for koder uden flag = den gamle regel. Admin kan ændre det under Leveringskoder.
  await prisma.$executeRaw`
    UPDATE "DeliveryCode" SET "ownRoute" = (code = 'LOVENCO' OR code ~ '^[AKS]') WHERE "ownRoute" IS NULL
  `
  await prisma.$executeRaw`ALTER TABLE "RouteStop" ADD COLUMN IF NOT EXISTS "kobSalesOrderNo" TEXT`
  await prisma.$executeRaw`ALTER TABLE "RouteStop" ADD COLUMN IF NOT EXISTS "bcCustomerNo" TEXT`
  await prisma.$executeRaw`ALTER TABLE "DriverUser" ADD COLUMN IF NOT EXISTS "bcShipmentMethodCode" TEXT`
  await prisma.$executeRaw`
    CREATE TABLE IF NOT EXISTS "CustomerRouteProfile" (
      "customerNo"      TEXT    PRIMARY KEY,
      "routeOrder"      INTEGER NOT NULL DEFAULT 5000,
      "defaultVehicle"  INTEGER NOT NULL DEFAULT 0,
      "updatedAt"       TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `
  // Biler: nummeret er nøglen (ruter gemmer "Bil N", kundeprofiler gemmer N), navnet er til visning.
  await prisma.$executeRaw`
    CREATE TABLE IF NOT EXISTS "Vehicle" (
      "number"    INTEGER PRIMARY KEY,
      "name"      TEXT    NOT NULL DEFAULT '',
      "plate"     TEXT,
      "active"    BOOLEAN NOT NULL DEFAULT true,
      "updatedAt" TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `
}

export interface VehicleInfo { number: number; label: string; name: string; plate: string | null; active: boolean; display: string }

/** "Bil 3" → 3. Andet end "Bil N" → 0. */
export function vehicleNumberOf(label: string | null | undefined): number {
  const m = /^Bil\s+(\d+)$/i.exec(String(label ?? '').trim())
  return m ? Number(m[1]) : 0
}

/** Biler fra tabellen + numre der bruges i ruter/profiler uden at være navngivet, 1..max (mindst 1..3). */
export async function loadVehicles(): Promise<VehicleInfo[]> {
  const rows = await prisma.$queryRaw<{ number: number; name: string; plate: string | null; active: boolean }[]>`
    SELECT "number", "name", "plate", "active" FROM "Vehicle" ORDER BY "number"
  `
  const used = await prisma.$queryRaw<{ n: number }[]>`
    SELECT GREATEST(
      COALESCE((SELECT MAX("defaultVehicle") FROM "CustomerRouteProfile"), 0),
      COALESCE((SELECT MAX(NULLIF(substring("vehicleLabel" from '^Bil ([0-9]+)$'), '')::int) FROM "RouteVehicle"), 0),
      COALESCE((SELECT MAX(NULLIF(substring("defaultVehicleLabel" from '^Bil ([0-9]+)$'), '')::int) FROM "DriverUser"), 0),
      3
    ) AS n
  `
  const max = Math.max(Number(used[0]?.n ?? 3), ...rows.map(r => Number(r.number)))
  const byNo = new Map(rows.map(r => [Number(r.number), r]))
  const out: VehicleInfo[] = []
  for (let n = 1; n <= max; n++) {
    const r = byNo.get(n)
    const name = r?.name?.trim() ?? ''
    out.push({
      number: n,
      label: `Bil ${n}`,
      name,
      plate: r?.plate ?? null,
      active: r ? Boolean(r.active) : true,
      display: name ? `Bil ${n} · ${name}` : `Bil ${n}`,
    })
  }
  return out
}

export async function loadOwnCodes(): Promise<Map<string, boolean | null>> {
  const rows = await prisma.$queryRaw<{ code: string; ownRoute: boolean | null }[]>`
    SELECT code, "ownRoute" FROM "DeliveryCode"
  `
  return new Map(rows.map(r => [r.code.toUpperCase().trim(), r.ownRoute]))
}

export async function loadProfiles(): Promise<ProfileMap> {
  const rows = await prisma.$queryRaw<any[]>`
    SELECT "customerNo", "routeOrder", "defaultVehicle" FROM "CustomerRouteProfile"
  `
  return Object.fromEntries(rows.map(p => [p.customerNo, {
    routeOrder:     Number(p.routeOrder),
    defaultVehicle: Number(p.defaultVehicle ?? 0),
  }]))
}

/** Forrige hverdag (lørdag + søndag springes over). */
export function prevBusinessDay(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00Z')
  do { d.setUTCDate(d.getUTCDate() - 1) } while (d.getUTCDay() === 0 || d.getUTCDay() === 6)
  return d.toISOString().slice(0, 10)
}

/** Næste hverdag (lørdag + søndag springes over). */
export function nextBusinessDay(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00Z')
  do { d.setUTCDate(d.getUTCDate() + 1) } while (d.getUTCDay() === 0 || d.getUTCDay() === 6)
  return d.toISOString().slice(0, 10)
}

/** Leveringskode-gruppen der køres i København (KØB* normaliseres til den). */
export const KBH_CODE = 'LOVENCO'

const isKobOrder = (o: { deliveryCodes: string[] }) => o.deliveryCodes.some(c => /^KØB/i.test(c.trim()))
const isLovencoOrder = (o: { deliveryCodes: string[] }) => o.deliveryCodes.some(c => c.trim().toUpperCase() === KBH_CODE)

/**
 * Ordrerne på ruten for UDKØRSELSDAG D, hver ordre højst én gang (Claus 21-10-2026):
 *  - LOVENCO-ordrer afsendt fra Hirtshals forrige hverdag (bogført der), køres ud i KBH på D
 *  - KØB-ordrer med afsendelse D (køres ud fra KBH-lageret samme dag)
 *  - alle andre ordrer med afsendelse D (Hirtshals-ruter)
 * Bogføringsdato = afsendelsesdag. Ønsket leveringsdato bruges kun, hvis den mangler.
 */
export async function loadRouteOrders(date: string) {
  const prev = prevBusinessDay(date)
  const [a, b] = await Promise.all([
    getSalesOrdersForDelivery(date, { fetchLines: false }),
    getSalesOrdersForDelivery(prev, { fetchLines: false }),
  ])
  const seen = new Set<string>()
  const out: typeof a = []
  for (const o of [...a, ...b]) {
    if (seen.has(o.id)) continue
    const dispatch = (o.postingDate || o.requestedDeliveryDate || '').slice(0, 10)
    const ok = isLovencoOrder(o) && !isKobOrder(o) ? dispatch === prev : dispatch === date
    if (ok) { seen.add(o.id); out.push(o) }
  }
  return out
}

/** "kbh" = København-gruppen (LOVENCO + KØB), "hirtshals" = resten. */
const groupOf = (code: string | null | undefined) => ((code ?? '').trim().toUpperCase() === KBH_CODE ? 'kbh' : 'hirtshals')

async function groupsWithStops(tx: any, date: string): Promise<Set<string>> {
  const rows = await tx.$queryRaw<{ code: string | null }[]>`
    SELECT DISTINCT s."deliveryCodeOverride" AS code
    FROM "DeliveryRoute" r
    JOIN "RouteVehicle" v ON v."routeId" = r.id
    JOIN "RouteStop"    s ON s."vehicleId" = v.id
    WHERE r."bookingDate"::date = ${date}::date
  `
  return new Set(rows.map((r: { code: string | null }) => groupOf(r.code)))
}

/**
 * Dan dagens rute automatisk ud fra BC-ordrerne og kundernes faste rutenumre/standardbiler.
 * København- og Hirtshals-gruppen udfyldes HVER FOR SIG: mangler én gruppe stops, tilføjes
 * den, uden at røre den anden (fx når København-turen er planlagt, men Hirtshals ikke er).
 * Ruten får status AUTO, når den oprettes her. Returnerer true hvis noget blev tilføjet.
 */
export async function materializeRouteIfMissing(date: string): Promise<boolean> {
  const present = await groupsWithStops(prisma, date)
  if (present.has('kbh') && present.has('hirtshals')) return false

  // BC hentes UDEN FOR transaktionen (kan tage mange sekunder).
  const orders = await loadRouteOrders(date)
  const [profiles, own] = await Promise.all([loadProfiles(), loadOwnCodes()])
  const fullPlan = buildAutoPlan(orders, profiles, own)
  if (fullPlan.every(v => v.stops.length === 0)) return false

  const now = new Date().toISOString()
  return prisma.$transaction(async tx => {
    // Lås pr. dato så to chauffører ikke opretter hver sin rute samtidig
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'route:' + date}))`
    const have = await groupsWithStops(tx, date)
    const plan = fullPlan
      .map(v => ({ ...v, stops: v.stops.filter(s => !have.has(groupOf(s.deliveryCodeOverride))) }))
      .filter(v => v.stops.length > 0)
    if (plan.length === 0) return false

    const existing = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM "DeliveryRoute" WHERE "bookingDate"::date = ${date}::date LIMIT 1
    `
    let routeId: string
    if (existing.length > 0) {
      routeId = existing[0].id
    } else {
      routeId = randomUUID()
      await tx.$executeRaw`
        INSERT INTO "DeliveryRoute" (id, "bookingDate", status, notes, "createdAt", "updatedAt")
        VALUES (${routeId}, ${date}::date, 'AUTO', NULL, ${now}::timestamp, ${now}::timestamp)
      `
    }

    for (const v of plan) {
      // Genbrug bilen, hvis ruten allerede har den; ellers opret den sidst.
      const found = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM "RouteVehicle" WHERE "routeId" = ${routeId} AND "vehicleLabel" = ${v.vehicleLabel} LIMIT 1
      `
      let vehicleId = found[0]?.id
      if (!vehicleId) {
        vehicleId = randomUUID()
        const mx = await tx.$queryRaw<{ n: number | null }[]>`SELECT MAX("sortOrder") AS n FROM "RouteVehicle" WHERE "routeId" = ${routeId}`
        await tx.$executeRaw`
          INSERT INTO "RouteVehicle" (id, "routeId", "vehicleLabel", "driverId", "sortOrder")
          VALUES (${vehicleId}, ${routeId}, ${v.vehicleLabel}, NULL, ${Number(mx[0]?.n ?? -1) + 1})
        `
      }
      const last = await tx.$queryRaw<{ n: number | null }[]>`SELECT MAX("sortOrder") AS n FROM "RouteStop" WHERE "vehicleId" = ${vehicleId}`
      let sort = Number(last[0]?.n ?? -1) + 1
      for (const s of v.stops) {
        await tx.$executeRaw`
          INSERT INTO "RouteStop" (
            id, "vehicleId", "driverId", "sortOrder", "deliveryCodeId", "deliveryCodeOverride",
            "bcSalesOrderNo", "bcSalesOrderId", "bcPurchaseOrderNo", "bcPurchaseOrderId",
            "isExtraTask", "extraTaskTitle", "extraTaskNote",
            "customerName", "customerAddress", "customerPhone", "totalWeightKg",
            "kobSalesOrderNo", "bcCustomerNo", status, "deliveredAt", "failureNote", "createdAt"
          ) VALUES (
            ${randomUUID()}, ${vehicleId}, NULL, ${sort++}, NULL, ${s.deliveryCodeOverride},
            ${s.bcSalesOrderNo}, ${s.bcSalesOrderId}, NULL, NULL,
            false, NULL, NULL,
            ${s.customerName}, ${s.customerAddress}, ${s.customerPhone}, ${s.totalWeightKg},
            ${s.kobSalesOrderNo}, ${s.bcCustomerNo}, 'PENDING', NULL, NULL, ${now}::timestamp
          )
        `
      }
    }
    return true
  }, { maxWait: 10_000, timeout: 60_000 })
}
