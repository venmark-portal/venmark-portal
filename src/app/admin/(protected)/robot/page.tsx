import { prisma } from '@/lib/prisma'
import { ensureRobotSkema } from '@/lib/robot/db'
import { robotKonfigureret } from '@/lib/robot/motor'
import {
  tilfoejRobotKunde, skiftRobotAktiv, skiftRobotInitiativ, fjernRobotKunde, vurderSvar, markerSvarBehandlet,
} from './actions'

export const dynamic = 'force-dynamic'

// Svar-robotten: hvem har den, hvad spørger kunderne om, hvad svarer den — og hvad koster
// det i tokens. Selve prisen pr. token står i Anthropic-konsollen (Usage).
//
// Læring sker her: kundernes og kontorets 👍/👎 samles under "Til gennemgang". Et dårligt
// svar rettes ved at skrive det rigtige under Robot-viden; et godt svar kan gemmes som
// viden, så robotten svarer ens næste gang — og så kontoret ser, hvad kunderne spørger om.

interface KundeRaekke {
  customerId: string; aktiv: boolean; initiativ: boolean
  name: string | null; bcCustomerNumber: string | null; idag: bigint
}
interface Forbrug { spoergsmaal: bigint; ind: bigint | null; ud: bigint | null; cache: bigint | null; fejl: bigint }
interface Besked {
  id: bigint; customerId: string; samtaleId: string; rolle: string; tekst: string; vaerktoejer: string
  somAdmin: string | null; createdAt: Date; name: string | null
  kundeVurdering: number | null; kundeKommentar: string | null; kontorVurdering: number | null
}
interface Gennemgang extends Besked { spoergsmaal: string | null }

const tid = (d: Date) => d.toLocaleString('da-DK', { timeZone: 'Europe/Copenhagen', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
const tal = (n: bigint | number | null) => Number(n ?? 0).toLocaleString('da-DK')
const tommel = (v: number | null) => (v === 1 ? '👍' : v === -1 ? '👎' : '')

async function forbrug(dage: number): Promise<Forbrug> {
  const rows = await prisma.$queryRaw<Forbrug[]>`
    SELECT COUNT(*) FILTER (WHERE rolle = 'kunde') AS spoergsmaal,
           SUM("inputTokens") AS ind, SUM("outputTokens") AS ud, SUM("cacheTokens") AS cache,
           COUNT(*) FILTER (WHERE rolle = 'fejl') AS fejl
    FROM "RobotBesked"
    WHERE "createdAt" >= NOW() - (${dage} * INTERVAL '1 day')
  `
  return rows[0]
}

/** Søgeord fra loggen: soeg_varer{"soegeord":"laks bakka"} (→0 = ingen træf). */
function soegninger(rows: { vaerktoejer: string }[]) {
  const alle = new Map<string, number>(), uden = new Map<string, number>()
  for (const r of rows) {
    for (const m of Array.from(r.vaerktoejer.matchAll(/soeg_varer\{"soegeord":"([^"]+)"[^}]*\}(→0)?/g))) {
      const ord = m[1].toLowerCase()
      alle.set(ord, (alle.get(ord) ?? 0) + 1)
      if (m[2]) uden.set(ord, (uden.get(ord) ?? 0) + 1)
    }
  }
  const top = (m: Map<string, number>, n: number) => Array.from(m.entries()).sort((a, b) => b[1] - a[1]).slice(0, n)
  return { mest: top(alle, 20), udenTraef: top(uden, 20) }
}

function VurderKnapper({ b }: { b: Besked }) {
  return (
    <div className="mt-1 flex flex-wrap items-center gap-1 text-xs">
      {b.kundeVurdering && <span className="rounded bg-white px-1.5">Kunde {tommel(b.kundeVurdering)}</span>}
      {[1, -1].map(v => (
        <form key={v} action={vurderSvar}>
          <input type="hidden" name="id" value={String(b.id)} />
          <input type="hidden" name="v" value={b.kontorVurdering === v ? '0' : String(v)} />
          <button title={v === 1 ? 'Godt svar' : 'Dårligt svar'}
            className={'rounded px-1.5 py-0.5 ' + (b.kontorVurdering === v ? 'bg-white shadow-sm' : 'opacity-50 hover:opacity-100')}>
            {tommel(v)}
          </button>
        </form>
      ))}
      <a href={`/admin/robot/viden?fra=${b.id}`} className="ml-1 rounded border border-gray-300 bg-white px-2 py-0.5 text-gray-700 hover:bg-gray-50">
        Gem som viden
      </a>
    </div>
  )
}

export default async function RobotAdminPage() {
  await ensureRobotSkema()
  const [kunder, alle, idag, maaned, beskeder, gennemgang, logs] = await Promise.all([
    prisma.$queryRaw<KundeRaekke[]>`
      SELECT r."customerId", r.aktiv, r.initiativ, c.name, c."bcCustomerNumber",
             (SELECT COUNT(*) FROM "RobotBesked" b WHERE b."customerId" = r."customerId" AND b.rolle = 'kunde'
                AND b."createdAt" >= date_trunc('day', NOW())) AS idag
      FROM "RobotKunde" r LEFT JOIN "Customer" c ON c.id = r."customerId"
      ORDER BY c.name
    `,
    prisma.customer.findMany({
      where: { isActive: true }, select: { name: true, bcCustomerNumber: true }, orderBy: { name: 'asc' },
    }),
    forbrug(1),
    forbrug(30),
    prisma.$queryRaw<Besked[]>`
      SELECT b.id, b."customerId", b."samtaleId", b.rolle, b.tekst, b.vaerktoejer, b."somAdmin", b."createdAt", c.name,
             b."kundeVurdering", b."kundeKommentar", b."kontorVurdering"
      FROM "RobotBesked" b LEFT JOIN "Customer" c ON c.id = b."customerId"
      WHERE b."samtaleId" IN (
        SELECT "samtaleId" FROM "RobotBesked" GROUP BY "samtaleId" ORDER BY MAX(id) DESC LIMIT 25
      )
      ORDER BY b.id ASC
    `,
    // Svar kunden har vurderet (godt ELLER dårligt), som kontoret ikke har set endnu.
    prisma.$queryRaw<Gennemgang[]>`
      SELECT b.id, b."customerId", b."samtaleId", b.rolle, b.tekst, b.vaerktoejer, b."somAdmin", b."createdAt", c.name,
             b."kundeVurdering", b."kundeKommentar", b."kontorVurdering",
             (SELECT k.tekst FROM "RobotBesked" k WHERE k."samtaleId" = b."samtaleId" AND k.id < b.id AND k.rolle = 'kunde'
              ORDER BY k.id DESC LIMIT 1) AS spoergsmaal
      FROM "RobotBesked" b LEFT JOIN "Customer" c ON c.id = b."customerId"
      WHERE b.rolle = 'robot' AND b."kundeVurdering" IS NOT NULL AND NOT b.behandlet
      ORDER BY b."kundeVurdering" ASC, b.id DESC
      LIMIT 50
    `,
    prisma.$queryRaw<{ vaerktoejer: string }[]>`
      SELECT vaerktoejer FROM "RobotBesked"
      WHERE rolle = 'robot' AND vaerktoejer LIKE '%soeg_varer%' AND "createdAt" >= NOW() - INTERVAL '30 days'
    `,
  ])

  const samtaler = new Map<string, Besked[]>()
  for (const b of beskeder) {
    if (!samtaler.has(b.samtaleId)) samtaler.set(b.samtaleId, [])
    samtaler.get(b.samtaleId)!.push(b)
  }
  const samtaleListe = Array.from(samtaler.values()).sort((a, b) => Number(b[b.length - 1].id - a[a.length - 1].id))
  const { mest, udenTraef } = soegninger(logs)

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Svar-robot</h1>
          <p className="mt-1 max-w-3xl text-sm text-gray-500">
            Robotten svarer kunderne i portalen ud fra deres egne priser, lager og ordrer. Den kan ikke bestille selv.
            Dagens forslag til disken tager den fra <a href="/admin/anbefalinger" className="text-blue-600 underline">Anbefalinger</a> og
            varer markeret &quot;Sælg for H&quot; i BC. Alt andet den ved, står under Robot-viden.
          </p>
        </div>
        <a href="/admin/robot/viden" className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">Robot-viden →</a>
      </div>

      {!robotKonfigureret() && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          ANTHROPIC_API_KEY mangler i .env.local på serveren — robotten er slået fra for alle.
        </p>
      )}

      <section className="grid gap-3 sm:grid-cols-2">
        {([['I dag (24 t)', idag], ['Seneste 30 dage', maaned]] as const).map(([titel, x]) => (
          <div key={titel} className="rounded-xl border border-gray-200 bg-white p-4">
            <h2 className="text-sm font-semibold text-gray-700">{titel}</h2>
            <p className="mt-1 text-2xl font-bold tabular-nums text-gray-900">{tal(x.spoergsmaal)} <span className="text-sm font-normal text-gray-500">spørgsmål</span></p>
            <p className="mt-1 text-xs tabular-nums text-gray-500">
              Tokens ind {tal(x.ind)} · ud {tal(x.ud)} · fra cache {tal(x.cache)}
              {Number(x.fejl) > 0 && <span className="text-red-600"> · {tal(x.fejl)} fejl</span>}
            </p>
          </div>
        ))}
      </section>

      <section className="rounded-xl border border-gray-200 bg-white p-4">
        <h2 className="text-base font-semibold text-gray-900">Til gennemgang <span className="text-sm font-normal text-gray-500">({gennemgang.length})</span></h2>
        <p className="mt-1 text-xs text-gray-500">
          Svar kunderne har givet 👍 eller 👎. Dårlige svar rettes ved at gemme det rigtige svar som viden. Gode svar kan
          gemmes som viden, så robotten svarer ens næste gang. Vurder selv med 👍/👎, eller tryk &quot;Set&quot;.
        </p>
        {gennemgang.length === 0 && <p className="mt-3 text-sm text-gray-500">Intet at gennemgå.</p>}
        <div className="mt-3 space-y-3">
          {gennemgang.map(b => (
            <div key={String(b.id)} className={'rounded-lg border p-3 ' + (b.kundeVurdering === -1 ? 'border-red-200 bg-red-50/50' : 'border-green-200 bg-green-50/50')}>
              <div className="text-xs text-gray-500">
                {tommel(b.kundeVurdering)} {b.name ?? '(ukendt)'} · {tid(b.createdAt)}
              </div>
              {b.spoergsmaal && <p className="mt-1 text-sm font-medium text-gray-900">&quot;{b.spoergsmaal}&quot;</p>}
              <p className="mt-1 whitespace-pre-wrap text-sm text-gray-700">{b.tekst}</p>
              {b.kundeKommentar && <p className="mt-1 text-sm text-red-800">Kundens kommentar: {b.kundeKommentar}</p>}
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <VurderKnapper b={b} />
                <form action={markerSvarBehandlet}>
                  <input type="hidden" name="id" value={String(b.id)} />
                  <button className="mt-1 text-xs text-gray-500 underline hover:text-gray-800">Set</button>
                </form>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="grid gap-3 md:grid-cols-2">
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <h2 className="text-base font-semibold text-gray-900">Kunderne søgte efter <span className="text-sm font-normal text-gray-500">(30 dage)</span></h2>
          {mest.length === 0 ? <p className="mt-2 text-sm text-gray-500">Ingen søgninger endnu.</p> : (
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {mest.map(([ord, n]) => <li key={ord} className="rounded-full bg-gray-100 px-2.5 py-0.5 text-sm text-gray-800">{ord} <span className="text-gray-400">{n}</span></li>)}
            </ul>
          )}
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <h2 className="text-base font-semibold text-gray-900">Søgninger uden træf <span className="text-sm font-normal text-gray-500">(30 dage)</span></h2>
          <p className="mt-1 text-xs text-gray-500">Varer kunderne ledte efter, men ikke fandt — måske et andet navn i BC, eller noget vi ikke fører.</p>
          {udenTraef.length === 0 ? <p className="mt-2 text-sm text-gray-500">Ingen.</p> : (
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {udenTraef.map(([ord, n]) => <li key={ord} className="rounded-full bg-amber-100 px-2.5 py-0.5 text-sm text-amber-900">{ord} <span className="text-amber-600">{n}</span></li>)}
            </ul>
          )}
        </div>
      </section>

      <section className="rounded-xl border border-gray-200 bg-white p-4">
        <h2 className="text-base font-semibold text-gray-900">Kunder med robotten</h2>
        <p className="mt-1 text-xs text-gray-500">
          &quot;Starter selv&quot; = robotten hilser med et forslag, når kunden åbner portalen. Kunden kan også selv slå det til og fra i chatten.
        </p>
        <form action={tilfoejRobotKunde} className="mt-3 flex flex-wrap gap-2">
          <label htmlFor="robot-kundenr" className="sr-only">Kunde</label>
          <input id="robot-kundenr" name="kundenr" list="robot-kundeliste" placeholder="Kundenr. eller navn → vælg på listen"
            className="min-w-0 flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm" />
          <datalist id="robot-kundeliste">
            {alle.map(c => <option key={c.bcCustomerNumber} value={`${c.bcCustomerNumber} ${c.name}`} />)}
          </datalist>
          <button className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">Slå robotten til</button>
        </form>

        {kunder.length === 0 ? (
          <p className="mt-4 text-sm text-gray-500">Ingen kunder endnu.</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-500">
                  <th className="py-2 pr-3">Kunde</th><th className="py-2 pr-3">Robot</th>
                  <th className="py-2 pr-3">Starter selv</th><th className="py-2 pr-3 text-right">I dag</th><th />
                </tr>
              </thead>
              <tbody>
                {kunder.map(k => (
                  <tr key={k.customerId} className="border-b border-gray-100">
                    <td className="py-2 pr-3">{k.name ?? '(ukendt)'} <span className="text-gray-400">{k.bcCustomerNumber}</span></td>
                    <td className="py-2 pr-3">
                      <form action={skiftRobotAktiv}>
                        <input type="hidden" name="id" value={k.customerId} />
                        <input type="hidden" name="aktiv" value={k.aktiv ? '0' : '1'} />
                        <button className={'rounded-full px-2.5 py-0.5 text-xs font-medium ' + (k.aktiv ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600')}>
                          {k.aktiv ? 'Til' : 'Fra'}
                        </button>
                      </form>
                    </td>
                    <td className="py-2 pr-3">
                      <form action={skiftRobotInitiativ}>
                        <input type="hidden" name="id" value={k.customerId} />
                        <input type="hidden" name="initiativ" value={k.initiativ ? '0' : '1'} />
                        <button className={'rounded-full px-2.5 py-0.5 text-xs font-medium ' + (k.initiativ ? 'bg-blue-100 text-blue-800' : 'bg-gray-100 text-gray-600')}>
                          {k.initiativ ? 'Ja' : 'Nej'}
                        </button>
                      </form>
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">{tal(k.idag)}</td>
                    <td className="py-2 text-right">
                      <form action={fjernRobotKunde}>
                        <input type="hidden" name="id" value={k.customerId} />
                        <button className="text-xs text-gray-400 hover:text-red-600">Fjern</button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="rounded-xl border border-gray-200 bg-white p-4">
        <h2 className="text-base font-semibold text-gray-900">Seneste samtaler</h2>
        {samtaleListe.length === 0 && <p className="mt-2 text-sm text-gray-500">Ingen samtaler endnu.</p>}
        <div className="mt-2 divide-y divide-gray-100">
          {samtaleListe.map(s => {
            const f = s[0]
            const foerste = s.find(b => b.rolle === 'kunde' && !b.tekst.startsWith('['))?.tekst ?? s[0].tekst
            const vurderinger = s.map(b => tommel(b.kundeVurdering)).join('')
            return (
              <details key={f.samtaleId} className="py-2">
                <summary className="cursor-pointer text-sm">
                  <span className="font-medium text-gray-900">{f.name ?? '(ukendt)'}</span>
                  <span className="text-gray-400"> · {tid(s[s.length - 1].createdAt)} · {s.filter(b => b.rolle === 'kunde').length} spm.</span>
                  {vurderinger && <span className="ml-1">{vurderinger}</span>}
                  {f.somAdmin && <span className="ml-1 rounded bg-orange-100 px-1.5 text-xs text-orange-700">admin: {f.somAdmin}</span>}
                  {s.some(b => b.rolle === 'fejl') && <span className="ml-1 rounded bg-red-100 px-1.5 text-xs text-red-700">fejl</span>}
                  <span className="block truncate text-gray-600">{foerste}</span>
                </summary>
                <div className="mt-2 space-y-2 pl-2">
                  {s.map(b => (
                    <div key={String(b.id)} className={
                      'rounded-lg px-3 py-2 text-sm ' +
                      (b.rolle === 'kunde' ? 'bg-blue-50' : b.rolle === 'fejl' ? 'bg-red-50 text-red-800' : 'bg-gray-50')
                    }>
                      <div className="mb-0.5 text-xs text-gray-400">
                        {b.rolle === 'kunde' ? 'Kunde' : b.rolle === 'fejl' ? 'Fejl' : 'Robot'} · {tid(b.createdAt)}
                        {b.vaerktoejer && ` · slog op: ${b.vaerktoejer.replace(/,(?=[a-z_]+\{|[a-z_]+$)/g, ', ')}`}
                      </div>
                      <div className="whitespace-pre-wrap">{b.tekst}</div>
                      {b.kundeKommentar && <p className="mt-1 text-xs text-red-800">Kundens kommentar: {b.kundeKommentar}</p>}
                      {b.rolle === 'robot' && <VurderKnapper b={b} />}
                    </div>
                  ))}
                </div>
              </details>
            )
          })}
        </div>
      </section>
    </div>
  )
}
