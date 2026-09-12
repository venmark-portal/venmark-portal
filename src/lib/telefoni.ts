// Teams-telefoni til kontorskærmen: antal opkald og minutter i dag.
//
// Venmark kører Direct Routing (bekræftet i Teams Admin Center → Usage reports →
// PSTN usage → fanen "Direct Routing"). Derfor `getDirectRoutingCalls` og ikke
// `getPstnCalls` — sidstnævnte dækker Calling Plan/Operator Connect og ville
// svare tomt hos os.
//
// Kræver APPLIKATIONS-tilladelsen CallRecords.Read.PstnCalls med administrator-
// samtykke. Mangler den, svarer Graph 403 og skærmen siger det, i stedet for at
// vise nul opkald som om telefonen stod stille.
//
// Opkaldstyper fra Graph: dr_in / dr_out er direkte opkald, dr_in_bot / dr_out_bot
// går gennem omstilling eller kø (fx Hovednummer_AA).

export interface TelefoniPerson {
  navn:     string
  ind:      number
  ud:       number
  /** Sekunder — vises som minutter, men summeres præcist. */
  sekunder: number
}

export interface TelefoniStat {
  dato:         string
  ind:          number
  ud:           number
  /** Opkald der aldrig blev besvaret. */
  ubesvarede:   number
  sekunder:     number
  personer:     TelefoniPerson[]
  /** Sat når tilladelsen mangler — så siger skærmen det i stedet for at vise 0. */
  mangler?:     string
}

async function graphToken(): Promise<string> {
  const tenant = process.env.BC_TENANT_ID!
  const id     = process.env.GRAPH_CLIENT_ID     ?? process.env.BC_CLIENT_ID!
  const secret = process.env.GRAPH_CLIENT_SECRET ?? process.env.BC_CLIENT_SECRET!

  const res = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    new URLSearchParams({
      grant_type: 'client_credentials', client_id: id, client_secret: secret,
      scope: 'https://graph.microsoft.com/.default',
    }),
    cache: 'no-store',   // aldrig cache et token-svar (heller ikke en 401)
  })
  if (!res.ok) throw new Error(`Graph-token ${res.status}`)
  return (await res.json()).access_token
}

/** Midnat dansk tid, udtrykt i UTC — så døgnet følger arbejdsdagen, ikke UTC. */
function doegnet(): { fra: string; til: string; dato: string } {
  const nu    = new Date()
  const dato  = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Copenhagen' }).format(nu)
  const lokal = new Date(`${dato}T00:00:00`)
  const fra   = new Date(lokal.getTime() - lokal.getTimezoneOffset() * 60000)
  return {
    dato,
    fra: fra.toISOString().replace(/\.\d{3}Z$/, 'Z'),
    til: new Date(fra.getTime() + 864e5).toISOString().replace(/\.\d{3}Z$/, 'Z'),
  }
}

export async function telefoniStat(): Promise<TelefoniStat> {
  const { fra, til, dato } = doegnet()
  const tom: TelefoniStat = { dato, ind: 0, ud: 0, ubesvarede: 0, sekunder: 0, personer: [] }

  const token = await graphToken()
  let url: string | null =
    `https://graph.microsoft.com/v1.0/communications/callRecords/getDirectRoutingCalls` +
    `(fromDateTime=${fra},toDateTime=${til})`

  const kald: any[] = []
  let sider = 0
  while (url && sider++ < 40) {
    const res: Response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      cache: 'no-store',
    } as any)
    if (res.status === 403 || res.status === 401) {
      return { ...tom, mangler: 'CallRecords.Read.PstnCalls mangler administrator-samtykke' }
    }
    if (!res.ok) throw new Error(`Graph getDirectRoutingCalls ${res.status}: ${(await res.text()).slice(0, 160)}`)
    const data = await res.json()
    kald.push(...(data.value ?? []))
    url = data['@odata.nextLink'] ?? null
  }

  const pr = new Map<string, TelefoniPerson>()
  const ud: TelefoniStat = { ...tom, personer: [] }

  for (const k of kald) {
    const indgaaende = String(k.callType ?? '').startsWith('dr_in')
    // duration sættes kun når opkaldet blev forbundet. Er det tomt, blev der
    // aldrig taget telefonen — det tal er mindst lige så interessant som minutterne.
    const sek = Number(k.duration ?? 0)
    if (k.successfulCall === false || !sek) ud.ubesvarede++
    if (indgaaende) ud.ind++; else ud.ud++
    ud.sekunder += sek

    const navn = String(k.userDisplayName || k.userPrincipalName || 'ukendt').trim()
    const p = pr.get(navn) ?? { navn, ind: 0, ud: 0, sekunder: 0 }
    if (indgaaende) p.ind++; else p.ud++
    p.sekunder += sek
    pr.set(navn, p)
  }

  ud.personer = Array.from(pr.values()).sort((a, b) => (b.ind + b.ud) - (a.ind + a.ud))
  return ud
}
