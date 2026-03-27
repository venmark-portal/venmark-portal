# Venmark Portal — Claude Code kontekst

## Projektbeskrivelse
Kundeportal for Venmark Fisk A/S bygget med Next.js 14 App Router + PostgreSQL.
Kunder kan bestille varer, se fakturaer, reklamere og se leveringsstatus.

## Server (produktion)
- **IP:** 204.168.191.215 (Hetzner VPS)
- **OS:** Ubuntu 24.04
- **Web:** Caddy (reverse proxy)
- **Process:** PM2 (`pm2 status`, `pm2 restart venmark`)
- **App-mappe:** `/var/www/venmark`
- **Logs:** `/root/.pm2/logs/venmark-error.log`
- **SSH-nøgle til git:** `/root/.ssh/deploy_key`

## Deploy-procedure
```bash
# Lokalt:
git push

# På serveren:
GIT_SSH_COMMAND='ssh -i /root/.ssh/deploy_key' git -C /var/www/venmark pull
cd /var/www/venmark && npm run build && pm2 restart venmark
```

## Database
- **PostgreSQL** på serveren
- **ORM:** Prisma (schema i `prisma/schema.prisma`)
- **VIGTIGT:** Al raw SQL skal bruge dobbelte anførselstegn om tabel- og kolonnenavne
  - Tabeller: `"Ticket"`, `"Order"`, `"DriverUser"` etc.
  - camelCase kolonner: `"customerId"`, `"bcOrderNumber"`, `"isDefault"` etc.
  - Booleans: `true`/`false` (IKKE `1`/`0` som i SQLite)
  - INSERT: `ON CONFLICT (id) DO NOTHING` (IKKE `INSERT OR IGNORE`)

## Business Central integration
- **API:** BC OData v2.0 + custom venmark/portal/v1.0 API
- **Auth:** OAuth2 client credentials (env vars nedenfor)
- **Extension:** Sales-warehouse-facade (SWF) i BC
- **AL-projekt:** `C:\Users\claus\OneDrive - Venmark Fisk A S\BC PROJEKT\SWF\`
- **Tilladte side-ID'er (portal):** 50150–50199, 50300–50399

### Vigtige BC tabeller
| Tabel | ID | Beskrivelse |
|---|---|---|
| Portal Customer Favorite | 50157 | Kundernes favoritter |
| Portal Standing Order Line | 50163 | Faste ordrelinjer (ugentlige mængder) |

### Vigtige BC API pages (venmark/portal/v1.0)
| Page | ID | EntitySet |
|---|---|---|
| Portal Standing Order API | 50166 | standingOrderLines |
| Portal Item Cutoff API | 50170 | itemCutoffs |

### BC feltnavne (OData JSON)
- `Portal Standing Order Line`: `customerNo`, `itemNo`, `qtyMonday`–`qtyFriday`, `unitOfMeasureCode`, `standingNote`
- `itemCutoffs`: `itemNo`, `portalCutoffWeekday`, `portalCutoffHour`, `portalSaelgForH`

## Miljøvariable (.env.local)
```
BC_TENANT_ID=ac081190-c3c1-4e72-966b-2d57f362306e
BC_CLIENT_ID=2fc221a4-b295-4980-a9f5-6c9e75649148
BC_CLIENT_SECRET=...
BC_ENVIRONMENT_NAME=Sandbox-Test
BC_COMPANY_ID=d4938cd7-52ed-f011-8405-000d3abfb7df
NEXTAUTH_SECRET=...
DATABASE_URL=postgresql://...
```

## Vigtig arkitektur
- **`src/lib/businesscentral.ts`** — alle BC API-kald
- **`src/lib/auth.ts`** — NextAuth + Prisma session
- **`src/lib/dateUtils.ts`** — `earliestDeliveryForItem()` til ugentlig cutoff-logik
- **`src/components/portal/OrderList.tsx`** — hoved-bestillingskomponent (client)
- **`src/app/portal/(protected)/bestil/page.tsx`** — bestillingssiden (server)

## Bestillingssiden — datakilder
```
allFavNos = bcStandardLines + portalPrices[portalFavorite] + dbFavorites
venmarkNos = itemCutoffs[saelgForH=true]  ← fra BC felt 50008
standingOrders = getStandingOrderLines(customerNo)  ← fra BC tabel 50163
itemCutoffs = getItemCutoffs()  ← cutoffWeekday/Hour + saelgForH
```

## Kendte problemer / workarounds
- Server har direkte edits der ikke er i git → altid `git stash` før `git pull`
- `next.config.js` på serveren har `typescript: { ignoreBuildErrors: true }` — TypeScript-fejl er ældre pre-existing issues
- Next.js fetch-cache kan cache 401-fejl → løses med `rm -rf .next/cache && npm run build`

## Item cutoff logik (bestillingsfrist pr. vare)
Felter på Item (tabel 27):
- `Portal Cutoff Weekday` (1=man…5=fre, 0=ingen)
- `Portal Cutoff Hour` (0–23)

Eksempel: Laks → cutoffWeekday=2 (tirsdag), cutoffHour=7
→ Bestilles til leverandør tirsdag 07:00
→ Kan leveres fra mandagen ugen efter
→ Se `earliestDeliveryForItem()` i dateUtils.ts
