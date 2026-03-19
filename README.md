# Venmark.dk — Next.js + Business Central

Produktkatalog der henter data direkte fra **Microsoft Dynamics 365 Business Central Online** via REST API.

---

## Kom i gang

### 1. Installer afhængigheder

```bash
npm install
```

### 2. Opsæt Business Central API adgang

Du skal bruge en **Azure App Registration** med adgang til Business Central.

#### Trin A — Opret App Registration i Azure Portal

1. Gå til [portal.azure.com](https://portal.azure.com)
2. Søg efter **"App registrations"** → **New registration**
3. Navngiv den fx `venmark-katalog`
4. **Supported account types**: "Accounts in this organizational directory only"
5. Klik **Register**

#### Trin B — Opret Client Secret

1. I din app: **Certificates & secrets** → **New client secret**
2. Vælg udløbsdato (fx 24 måneder)
3. Kopiér **Value** — den vises kun én gang!

#### Trin C — Giv adgang til Business Central

1. I Azure Portal: **API permissions** → **Add a permission** → **Dynamics 365 Business Central** → **Application permissions**
2. Tilføj: `API.ReadWrite.All`
3. Klik **Grant admin consent**

4. I **Business Central**: Søg efter "Azure Active Directory Applications"
5. Tilføj din app med Client ID og tildel relevante roller (fx "Read" eller "Super")

#### Trin D — Find dit Company GUID

```
GET https://api.businesscentral.dynamics.com/v2.0/{TENANT_ID}/production/api/v2.0/companies
Authorization: Bearer {access_token}
```

Kopier `id`-feltet fra det relevante selskab.

### 3. Udfyld `.env.local`

```env
BC_TENANT_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
BC_CLIENT_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
BC_CLIENT_SECRET=dit-client-secret-her
BC_ENVIRONMENT_NAME=production
BC_COMPANY_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
```

### 4. Start udviklingsserver

```bash
npm run dev
```

Åbn [http://localhost:3000](http://localhost:3000)

---

## Projektstruktur

```
src/
├── app/
│   ├── layout.tsx          # Hoved-layout, header og footer
│   ├── page.tsx            # Forsiden med katalog
│   ├── globals.css         # Tailwind + globale styles
│   └── api/
│       ├── products/       # GET /api/products?search=&category=
│       └── categories/     # GET /api/categories
├── components/
│   ├── ProductCatalog.tsx  # Hoved-komponent med state og paginering
│   ├── ProductCard.tsx     # Enkelt varekort
│   ├── SearchBar.tsx       # Søgefelt
│   └── CategoryFilter.tsx  # Kategori-filtre (pills)
└── lib/
    └── businesscentral.ts  # BC API klient (token + kald)
```

---

## Deploy

Anbefalet: **Vercel** (gratis for small projects)

```bash
npm run build
```

Husk at tilføje alle `BC_*` environment variables i Vercel's dashboard under **Settings → Environment Variables**.

---

## Sikkerhed

- `.env.local` er i `.gitignore` og committes **aldrig** til Git
- API kald til BC sker server-side — credentials eksponeres aldrig i browseren
- Token caches i memory og genbruges til det udløber
