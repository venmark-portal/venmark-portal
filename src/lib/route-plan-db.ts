// Server-side del af ruteplanlægningen: skema-sikring, opslag og automatisk rute.
import { randomUUID } from 'crypto'
import { prisma } from '@/lib/prisma'
import { getSalesOrdersForDelivery, getAccessToken, bcBaseUrl, getPortalShipmentMethods } from '@/lib/businesscentral'
import { buildAutoPlan, DEFAULT_ROUTE_ORDER, type ProfileMap } from '@/lib/route-plan'

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

const isKobCode = (c: string) => /^KØB/i.test((c ?? "").trim())

/** Lægger n hverdage til (lørdag + søndag springes over). */
function addBusinessDays(dateStr: string, n: number): string {
  let d = dateStr
  for (let i = 0; i < n; i++) d = nextBusinessDay(d)
  return d
}

/**
 * Alle leverancer BOGFØRT på `postingDate` (Portal Delivery Shipment API, page 50807).
 * Bogføring = afsendt fra Hirtshals; salgsordren findes ikke længere som åben ordre, men
 * leverancen skal stadig køres ud. KØB-leverancer udelades: en bogført KØB-ordre er leveret.
 */
async function postedShipments(postingDate: string) {
  const token = await getAccessToken()
  const base = `https://api.businesscentral.dynamics.com/v2.0/${process.env.BC_TENANT_ID}/${process.env.BC_ENVIRONMENT_NAME ?? "production"}/api/venmark/portal/v1.0/companies(${process.env.BC_COMPANY_ID})`
  const res = await fetch(`${base}/deliveryShipments?$filter=${encodeURIComponent(`postingDate eq ${postingDate}`)}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }, cache: "no-store",
  })
  if (!res.ok) throw new Error(`BC deliveryShipments fejl (${res.status}): ${await res.text()}`)
  const rows: any[] = (await res.json()).value ?? []
  return rows
    .filter(s => !isKobCode(s.shipmentMethodCode ?? ""))
    .map(s => ({
      id:                    `shp-${s.id}`,           // eget id: salgsordren findes ikke længere
      number:                s.orderNumber || s.number,
      customerNumber:        s.customerNumber ?? "",
      customerName:          s.customerName ?? "",
      shipToName:            s.shipToName ?? s.customerName ?? "",
      shipToAddress:         s.shipToAddress ?? "",
      shipToCity:            s.shipToCity ?? "",
      shipToPostCode:        s.shipToPostCode ?? "",
      shipToPhone:           "",
      requestedDeliveryDate: "",
      postingDate:           (s.postingDate ?? postingDate).slice(0, 10),
      status:                "Posted",
      totalWeightKg:         s.totalNetWeightKg ?? 0,
      portalRouteOrder:      0,
      deliveryCodes:         [(s.shipmentMethodCode ?? "").trim() || "VENMARK"],
      lines:                 [],
    }))
}

/**
 * Ordrerne på ruten for UDKØRSELSDAG D, hver ordre højst én gang (Claus 21-10-2026).
 * Udkørselsdag = ønsket leveringsdato, hvis ordren har en; ellers bogføringsdato +
 * leveringskodens transitdage (Portal Transit Days; "samme dag" = 0). KØB-ordrer bogføres
 * den dag, de køres ud fra KBH, så for dem er udkørselsdag = bogføringsdato.
 * Både åbne ordrer og bogførte leverancer tæller (bogført = afsendt, ikke leveret), undtagen
 * bogførte KØB-ordrer (= leveret). Eksempler: SELVNAT/SELVMORGEN/LOVENCO (transit 1)
 * bogført i går → i dag; ANDEN TUR/SELV-SKAGE/VENMARK (transit 0) bogført i dag → i dag.
 */
export async function loadRouteOrders(date: string) {
  const prev = prevBusinessDay(date)
  const [openToday, openPrev, postedToday, postedPrev, methods] = await Promise.all([
    getSalesOrdersForDelivery(date, { fetchLines: false }),
    getSalesOrdersForDelivery(prev, { fetchLines: false }),
    postedShipments(date),
    postedShipments(prev),
    getPortalShipmentMethods(),
  ])
  if (methods.length === 0) throw new Error("Kunne ikke hente leveringskodernes transitdage fra BC")
  const transit = new Map(methods.map(m => [m.code.trim().toUpperCase(), m.sameDay ? 0 : (m.transitDays ?? 1)]))
  const deliveryDay = (o: { deliveryCodes: string[]; requestedDeliveryDate: string; postingDate: string }) => {
    const req = (o.requestedDeliveryDate || "").slice(0, 10)
    if (req) return req
    const post = (o.postingDate || "").slice(0, 10)
    if (!post) return ""
    const code = (o.deliveryCodes[0] ?? "").trim().toUpperCase()
    if (isKobCode(code)) return post
    return addBusinessDays(post, transit.get(code) ?? 0)
  }

  const open = [...openToday, ...openPrev]
  // En ordre, der er delvist leveret, kan findes både åben og bogført — den åbne vinder.
  const openNos = new Set(open.map(o => o.number))
  const posted = [...postedToday, ...postedPrev].filter(p => !openNos.has(p.number)) as unknown as typeof open
  const seen = new Set<string>()
  const out: typeof open = []
  for (const o of [...open, ...posted]) {
    if (seen.has(o.id)) continue
    if (deliveryDay(o) === date) { seen.add(o.id); out.push(o) }
  }
  return out
}

/**
 * Hvilke af de givne ordrenumre er stadig ÅBNE salgsordrer i BC? En KØB-ordre, der er
 * bogført, er leveret (den bogføres ved udkørsel i KBH) og skal ikke vises på ruten.
 * Fejler BC-kaldet, regnes alle som åbne — hellere vise for meget end skjule en levering.
 */
export async function openOrderNumbers(numbers: string[]): Promise<Set<string>> {
  const uniq = Array.from(new Set(numbers.filter(Boolean)))
  if (uniq.length === 0) return new Set()
  try {
    const token = await getAccessToken()
    const headers = { Authorization: `Bearer ${token}`, Accept: 'application/json' }
    const open = new Set<string>()
    for (let i = 0; i < uniq.length; i += 15) {
      const chunk = uniq.slice(i, i + 15)
      const filter = encodeURIComponent(chunk.map(n => `number eq '${n.replace(/'/g, "''")}'`).join(' or '))
      const res = await fetch(`${bcBaseUrl()}/salesOrders?$filter=${filter}&$select=number`, { headers, cache: 'no-store' })
      if (!res.ok) { console.error('openOrderNumbers', res.status, await res.text()); return new Set(uniq) }
      for (const o of (await res.json()).value ?? []) open.add(o.number)
    }
    return open
  } catch (err) {
    console.error('openOrderNumbers fejlede:', err instanceof Error ? err.message : err)
    return new Set(uniq)
  }
}

/**
 * Kommende AUTO-ruter (dannet automatisk, ikke planlagt i hånden) sorteres igen efter
 * kundernes faste rutenumre, så en rækkefølge der rettes i dag også gælder ruter, der
 * allerede er dannet for de næste dage. Kun stops der ikke er afleveret flyttes; rækkefølgen
 * pr. bil og leveringskode følger rutenummeret, uafgjort beholder den nuværende orden.
 * Planlagte ruter (status DRAFT, gemt fra planlægningssiden) røres ikke.
 */
export async function resortFutureAutoRoutes(afterDate: string): Promise<number> {
  const rows = await prisma.$queryRaw<{ id: string; vehicleId: string; sortOrder: number; code: string | null; status: string; ro: number | null }[]>`
    SELECT s.id, s."vehicleId", s."sortOrder", s."deliveryCodeOverride" AS code, s.status, p."routeOrder" AS ro
    FROM "DeliveryRoute" r
    JOIN "RouteVehicle" v ON v."routeId" = r.id
    JOIN "RouteStop"    s ON s."vehicleId" = v.id
    LEFT JOIN "CustomerRouteProfile" p ON p."customerNo" = s."bcCustomerNo"
    WHERE r."bookingDate"::date > ${afterDate}::date AND r.status = 'AUTO'
    ORDER BY s."vehicleId", s."sortOrder"
  `
  const byVehicle = new Map<string, typeof rows>()
  for (const r of rows) { if (!byVehicle.has(r.vehicleId)) byVehicle.set(r.vehicleId, []); byVehicle.get(r.vehicleId)!.push(r) }
  let changed = 0
  for (const list of Array.from(byVehicle.values())) {
    // Sortér hver leveringskode for sig inden for de pladser, koden allerede har i bilen.
    const codes = Array.from(new Set(list.map(s => s.code ?? '')))
    const result = [...list]
    for (const c of codes) {
      const slots = list.map((s, i) => ({ s, i })).filter(x => (x.s.code ?? '') === c && x.s.status === 'PENDING')
      const sorted = [...slots].sort((a, b) => (a.s.ro ?? DEFAULT_ROUTE_ORDER) - (b.s.ro ?? DEFAULT_ROUTE_ORDER) || a.i - b.i)
      slots.forEach((slot, k) => { result[slot.i] = sorted[k].s })
    }
    for (let i = 0; i < result.length; i++) {
      if (result[i].sortOrder !== i) {
        await prisma.$executeRaw`UPDATE "RouteStop" SET "sortOrder" = ${i} WHERE id = ${result[i].id}`
        changed++
      }
    }
  }
  return changed
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
