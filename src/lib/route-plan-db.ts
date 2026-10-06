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

/** Næste hverdag (lørdag + søndag springes over). */
export function nextBusinessDay(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00Z')
  do { d.setUTCDate(d.getUTCDate() + 1) } while (d.getUTCDay() === 0 || d.getUTCDay() === 6)
  return d.toISOString().slice(0, 10)
}

async function routeHasStops(date: string): Promise<boolean> {
  const rows = await prisma.$queryRaw<{ n: bigint }[]>`
    SELECT count(s.id) AS n
    FROM "DeliveryRoute" r
    JOIN "RouteVehicle" v ON v."routeId" = r.id
    JOIN "RouteStop"    s ON s."vehicleId" = v.id
    WHERE r."bookingDate"::date = ${date}::date
  `
  return Number(rows[0]?.n ?? 0) > 0
}

/**
 * Findes der ingen gemt rute for dagen, dannes den automatisk ud fra BC-ordrerne og
 * kundernes faste rutenumre/standardbiler — præcis som admin-siden ville gemme den.
 * Ruten får status AUTO, så den kan kendes fra en admin-planlagt rute.
 * Returnerer true hvis en rute blev oprettet.
 */
export async function materializeRouteIfMissing(date: string): Promise<boolean> {
  if (await routeHasStops(date)) return false

  // BC hentes UDEN FOR transaktionen (kan tage mange sekunder).
  // Som admin-siden: dagens ordrer + næste hverdags KØB*-ordrer (pakkes i KBH med LOVENCO).
  const [todayOrders, nextOrders] = await Promise.all([
    getSalesOrdersForDelivery(date, { fetchLines: false }),
    getSalesOrdersForDelivery(nextBusinessDay(date), { fetchLines: false }),
  ])
  const kobNext = nextOrders.filter(o => o.deliveryCodes.some(c => /^KØB/i.test(c.trim())))
  const [profiles, own] = await Promise.all([loadProfiles(), loadOwnCodes()])
  const plan = buildAutoPlan([...todayOrders, ...kobNext], profiles, own)
  if (plan.every(v => v.stops.length === 0)) return false

  const now = new Date().toISOString()
  return prisma.$transaction(async tx => {
    // Lås pr. dato så to chauffører ikke opretter hver sin rute samtidig
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'route:' + date}))`
    const again = await tx.$queryRaw<{ n: bigint }[]>`
      SELECT count(s.id) AS n
      FROM "DeliveryRoute" r
      JOIN "RouteVehicle" v ON v."routeId" = r.id
      JOIN "RouteStop"    s ON s."vehicleId" = v.id
      WHERE r."bookingDate"::date = ${date}::date
    `
    if (Number(again[0]?.n ?? 0) > 0) return false

    const existing = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM "DeliveryRoute" WHERE "bookingDate"::date = ${date}::date LIMIT 1
    `
    let routeId: string
    if (existing.length > 0) {
      routeId = existing[0].id
      await tx.$executeRaw`DELETE FROM "RouteVehicle" WHERE "routeId" = ${routeId}`
      await tx.$executeRaw`UPDATE "DeliveryRoute" SET status = 'AUTO', "updatedAt" = ${now}::timestamp WHERE id = ${routeId}`
    } else {
      routeId = randomUUID()
      await tx.$executeRaw`
        INSERT INTO "DeliveryRoute" (id, "bookingDate", status, notes, "createdAt", "updatedAt")
        VALUES (${routeId}, ${date}::date, 'AUTO', NULL, ${now}::timestamp, ${now}::timestamp)
      `
    }

    for (let vi = 0; vi < plan.length; vi++) {
      const v = plan[vi]
      const vehicleId = randomUUID()
      await tx.$executeRaw`
        INSERT INTO "RouteVehicle" (id, "routeId", "vehicleLabel", "driverId", "sortOrder")
        VALUES (${vehicleId}, ${routeId}, ${v.vehicleLabel}, NULL, ${vi})
      `
      for (let si = 0; si < v.stops.length; si++) {
        const s = v.stops[si]
        await tx.$executeRaw`
          INSERT INTO "RouteStop" (
            id, "vehicleId", "driverId", "sortOrder", "deliveryCodeId", "deliveryCodeOverride",
            "bcSalesOrderNo", "bcSalesOrderId", "bcPurchaseOrderNo", "bcPurchaseOrderId",
            "isExtraTask", "extraTaskTitle", "extraTaskNote",
            "customerName", "customerAddress", "customerPhone", "totalWeightKg",
            "kobSalesOrderNo", "bcCustomerNo", status, "deliveredAt", "failureNote", "createdAt"
          ) VALUES (
            ${randomUUID()}, ${vehicleId}, NULL, ${si}, NULL, ${s.deliveryCodeOverride},
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
