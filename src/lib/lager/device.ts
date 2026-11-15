// Håndterminalens eget lager: varekataloget offline og en udbakke der ikke tæller dobbelt.
//
// Tre regler hele appen hviler på:
//   1. Enheden GÆTTER, serveren BESTEMMER. Det offline-katalog er til at vise navne og
//      genkende koder med — aldrig til at afgøre hvad der blev talt.
//   2. Hver handling får en nøgle lavet HER. Serveren svarer det samme på samme nøgle,
//      så en genafspillet udbakke efter dårligt wifi ikke tæller noget to gange.
//   3. Intet ryger ud af udbakken før serveren har sagt ja. Lukker skærmen, står det der
//      stadig næste gang terminalen tændes.
//
// Skrevet på rå IndexedDB med vilje: ingen ny afhængighed at vedligeholde, og den
// overlever at serveren prunes for devDependencies ved deploy.

const DB_NAVN = 'venmark-lager'
const DB_VERSION = 1

export interface KatalogVare {
  nr: string
  navn: string
  enhed: string
  kategori: string
  gtin: string
  aendret: string
}

export interface UdbakkePost {
  key: string
  endpoint: string
  payload: any
  oprettet: number
  forsoeg: number
  sidsteFejl?: string
}

function harIndexedDB(): boolean {
  return typeof window !== 'undefined' && !!window.indexedDB
}

export function nyNoegle(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  // Ældre webview på en billig terminal: tid + tilfældigt er nok til at være unik.
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

function aabnDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!harIndexedDB()) return reject(new Error('IndexedDB findes ikke'))
    const req = indexedDB.open(DB_NAVN, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains('varer')) {
        const s = db.createObjectStore('varer', { keyPath: 'nr' })
        s.createIndex('gtin', 'gtin', { unique: false })
      }
      if (!db.objectStoreNames.contains('meta')) {
        db.createObjectStore('meta')
      }
      if (!db.objectStoreNames.contains('udbakke')) {
        db.createObjectStore('udbakke', { keyPath: 'key' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function tx<T>(store: string, mode: IDBTransactionMode, arbejd: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return aabnDb().then(
    db =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(store, mode)
        const req = arbejd(t.objectStore(store))
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
        t.oncomplete = () => db.close()
      }),
  )
}

// ─── Katalog ────────────────────────────────────────────────────────────────

export async function gemKatalog(varer: KatalogVare[], version: string): Promise<void> {
  const db = await aabnDb()
  await new Promise<void>((resolve, reject) => {
    const t = db.transaction(['varer', 'meta'], 'readwrite')
    const s = t.objectStore('varer')
    for (const v of varer) s.put(v)
    t.objectStore('meta').put(version, 'katalogVersion')
    t.objectStore('meta').put(Date.now(), 'katalogHentet')
    t.oncomplete = () => { db.close(); resolve() }
    t.onerror = () => { db.close(); reject(t.error) }
  })
}

export async function katalogVersion(): Promise<string> {
  try {
    return (await tx<string>('meta', 'readonly', s => s.get('katalogVersion'))) ?? ''
  } catch {
    return ''
  }
}

export async function antalVarer(): Promise<number> {
  try {
    return (await tx<number>('varer', 'readonly', s => s.count())) ?? 0
  } catch {
    return 0
  }
}

export async function hentVare(nr: string): Promise<KatalogVare | undefined> {
  try {
    return await tx<KatalogVare>('varer', 'readonly', s => s.get(nr.toUpperCase()))
  } catch {
    return undefined
  }
}

/** Slår en EAN op i det offline katalog. Kun til at vise et navn STRAKS — serveren
 *  er stadig den der afgør hvad koden betyder. */
export async function hentVareVedGtin(gtin: string): Promise<KatalogVare | undefined> {
  if (!gtin) return undefined
  try {
    const db = await aabnDb()
    return await new Promise<KatalogVare | undefined>((resolve, reject) => {
      const t = db.transaction('varer', 'readonly')
      const req = t.objectStore('varer').index('gtin').get(gtin)
      req.onsuccess = () => { db.close(); resolve(req.result) }
      req.onerror = () => { db.close(); reject(req.error) }
    })
  } catch {
    return undefined
  }
}

/** Fritekstsøgning i det offline katalog — til "varen har ingen stregkode". */
export async function soegVarer(tekst: string, maks = 30): Promise<KatalogVare[]> {
  const q = tekst.trim().toUpperCase()
  if (q.length < 2) return []
  const db = await aabnDb()
  return new Promise<KatalogVare[]>((resolve, reject) => {
    const fundet: KatalogVare[] = []
    const t = db.transaction('varer', 'readonly')
    const req = t.objectStore('varer').openCursor()
    req.onsuccess = () => {
      const c = req.result
      if (!c || fundet.length >= maks) { db.close(); resolve(fundet); return }
      const v = c.value as KatalogVare
      if (v.nr.toUpperCase().includes(q) || v.navn.toUpperCase().includes(q)) fundet.push(v)
      c.continue()
    }
    req.onerror = () => { db.close(); reject(req.error) }
  })
}

/**
 * Henter nyt eller ændret i kataloget. Første gang: alt. Derefter kun det der er
 * ændret, så en terminal i frostrummet ikke skal trække 4.000 varer igen.
 */
export async function synkroniserKatalog(): Promise<{ hentet: number; ialt: number } | null> {
  try {
    const since = await katalogVersion()
    const res = await fetch(`/api/lager/katalog${since ? `?since=${encodeURIComponent(since)}` : ''}`, {
      cache: 'no-store',
    })
    if (!res.ok) return null
    const data = await res.json()
    if (Array.isArray(data.varer) && data.varer.length > 0) {
      await gemKatalog(data.varer, data.version ?? since)
    } else if (data.version && data.version !== since) {
      await tx('meta', 'readwrite', s => s.put(data.version, 'katalogVersion'))
    }
    return { hentet: data.varer?.length ?? 0, ialt: await antalVarer() }
  } catch {
    return null
  }
}

// ─── Udbakke ────────────────────────────────────────────────────────────────

export async function laegIUdbakke(endpoint: string, payload: any): Promise<string> {
  const post: UdbakkePost = {
    key: nyNoegle(),
    endpoint,
    payload,
    oprettet: Date.now(),
    forsoeg: 0,
  }
  await tx('udbakke', 'readwrite', s => s.put(post))
  return post.key
}

export async function udbakke(): Promise<UdbakkePost[]> {
  try {
    return (await tx<UdbakkePost[]>('udbakke', 'readonly', s => s.getAll())) ?? []
  } catch {
    return []
  }
}

export async function udbakkeAntal(): Promise<number> {
  try {
    return (await tx<number>('udbakke', 'readonly', s => s.count())) ?? 0
  } catch {
    return 0
  }
}

/**
 * Sender udbakken i den rækkefølge den blev lavet. Nøglen følger med som
 * idempotencyKey, så et gensendt kald ikke tæller to gange.
 * 4xx = serveren har afvist handlingen; den bliver IKKE prøvet igen i al evighed,
 * men bliver liggende med sin fejl, så et menneske kan se hvad der skete.
 */
export async function sendUdbakke(): Promise<{ sendt: number; tilbage: number; fejl: string[] }> {
  const poster = (await udbakke()).sort((a, b) => a.oprettet - b.oprettet)
  let sendt = 0
  const fejl: string[] = []

  for (const post of poster) {
    if (post.forsoeg >= 5 && post.sidsteFejl?.startsWith('4')) continue
    try {
      const res = await fetch(post.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...post.payload, idempotencyKey: post.key }),
      })
      if (res.ok) {
        await tx('udbakke', 'readwrite', s => s.delete(post.key))
        sendt++
        continue
      }
      const tekst = await res.text().catch(() => '')
      post.forsoeg++
      post.sidsteFejl = `${res.status} ${tekst}`.slice(0, 200)
      await tx('udbakke', 'readwrite', s => s.put(post))
      fejl.push(post.sidsteFejl)
      // 5xx/502 = serveren eller BC er nede. Stop her: resten skal sendes i
      // rækkefølge, og der er ingen grund til at hamre videre.
      if (res.status >= 500) break
    } catch (e: any) {
      post.forsoeg++
      post.sidsteFejl = `offline: ${e?.message ?? ''}`.slice(0, 200)
      await tx('udbakke', 'readwrite', s => s.put(post))
      break
    }
  }

  return { sendt, tilbage: await udbakkeAntal(), fejl }
}
