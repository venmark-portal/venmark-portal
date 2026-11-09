import { prisma } from '@/lib/prisma'
import { sikrAktivitetsTabel, danskDag } from '@/lib/aktivitet'

export const dynamic = 'force-dynamic'

// Portal-brug pr. kunde — data fra "PortalAktivitet" (se src/lib/aktivitet.ts).

const PERIODER = [7, 30, 90] as const

const SIDENAVNE: Record<string, string> = {
  '/portal':                   'Oversigt',
  '/portal/bestil':            'Bestil',
  '/portal/ordrer':            'Ordrer',
  '/portal/ordrer/:id':        'Ordre (detalje)',
  '/portal/fakturaer':         'Fakturaer',
  '/portal/beskeder':          'Beskeder',
  '/portal/reklamationer':     'Reklamationer',
  '/portal/reklamationer/ny':  'Ny reklamation',
  '/portal/profil':            'Profil',
  '/portal/hjaelp':            'Support og vejledning',
  '/portal/auktion':           'Auktion',
}

function varighed(sek: number): string {
  const min = Math.round(sek / 60)
  if (min < 60) return `${min} min`
  return `${Math.floor(min / 60)} t ${min % 60} min`
}

const tidFmt = new Intl.DateTimeFormat('da-DK', {
  timeZone: 'Europe/Copenhagen', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
})
const dagFmt = new Intl.DateTimeFormat('da-DK', { timeZone: 'UTC', weekday: 'short', day: '2-digit', month: '2-digit' })

export default async function PortalBrugPage({ searchParams }: { searchParams: { dage?: string; kunde?: string } }) {
  await sikrAktivitetsTabel()
  const dage  = PERIODER.includes(Number(searchParams.dage) as any) ? Number(searchParams.dage) : 30
  const kunde = searchParams.kunde?.trim() || ''
  const idag  = danskDag()
  const fra   = danskDag(new Date(Date.now() - (dage - 1) * 86_400_000))

  const [foerste] = await prisma.$queryRaw<{ dag: Date | null }[]>`SELECT min("dag") AS dag FROM "PortalAktivitet"`

  const total = (await prisma.$queryRaw<any[]>`
    SELECT count(DISTINCT "kundeNr")::int AS kunder,
           count(DISTINCT "brugerEmail")::int AS brugere,
           COALESCE(sum("aktiveSekunder"), 0)::int AS sek,
           COALESCE(sum("sidevisninger"), 0)::int AS visninger,
           count(DISTINCT "kundeNr") FILTER (WHERE "dag" = ${idag}::date)::int AS idag
    FROM "PortalAktivitet" WHERE "dag" >= ${fra}::date`)[0]

  const pr_dag = await prisma.$queryRaw<{ dag: Date; kunder: number; sek: number }[]>`
    SELECT "dag", count(DISTINCT "kundeNr")::int AS kunder, sum("aktiveSekunder")::int AS sek
    FROM "PortalAktivitet" WHERE "dag" >= ${fra}::date
    GROUP BY "dag" ORDER BY "dag"`

  const kunder = await prisma.$queryRaw<any[]>`
    SELECT "kundeNr", max("kundeNavn") AS navn,
           count(DISTINCT "dag")::int AS dage,
           sum("aktiveSekunder")::int AS sek,
           sum("sidevisninger")::int AS visninger,
           count(DISTINCT "brugerEmail")::int AS brugere,
           max("sidsteBesoeg") AS sidst,
           round(100.0 * count(*) FILTER (WHERE "enhed" = 'mobil') / count(*))::int AS mobil
    FROM "PortalAktivitet" WHERE "dag" >= ${fra}::date
    GROUP BY "kundeNr" ORDER BY sum("aktiveSekunder") DESC, sum("sidevisninger") DESC`

  const sider = await prisma.$queryRaw<{ sti: string; antal: number; kunder: number }[]>`
    SELECT s.key AS sti, sum(s.value::int)::int AS antal, count(DISTINCT a."kundeNr")::int AS kunder
    FROM "PortalAktivitet" a, jsonb_each_text(a."sider") s
    WHERE a."dag" >= ${fra}::date
    GROUP BY s.key ORDER BY 2 DESC LIMIT 15`

  const sete = new Set(kunder.map(k => k.kundeNr))
  const aktiveKunder = await prisma.customer.findMany({
    where: { isActive: true, bcBlocked: false },
    select: { bcCustomerNumber: true, name: true },
    orderBy: { name: 'asc' },
  })
  const ikkeSet = aktiveKunder.filter(c => !sete.has(c.bcCustomerNumber))

  const detalje = kunde ? await prisma.$queryRaw<any[]>`
    SELECT "dag", "brugerNavn", "brugerEmail", "erKontakt", "enhed", "foersteBesoeg", "sidsteBesoeg",
           "aktiveSekunder"::int AS sek, "sidevisninger"::int AS visninger, "sider"
    FROM "PortalAktivitet" WHERE "kundeNr" = ${kunde} AND "dag" >= ${fra}::date
    ORDER BY "dag" DESC, "sidsteBesoeg" DESC` : []

  // Alle dage i perioden, også dem uden besøg, så søjlerne står på en fast tidsakse.
  const dagRaekke: { dag: string; kunder: number; sek: number }[] = []
  const pd = new Map(pr_dag.map((r: any) => [new Date(r.dag).toISOString().slice(0, 10), r]))
  for (let i = dage - 1; i >= 0; i--) {
    const d = danskDag(new Date(Date.now() - i * 86_400_000))
    const r: any = pd.get(d)
    dagRaekke.push({ dag: d, kunder: r?.kunder ?? 0, sek: r?.sek ?? 0 })
  }
  const maxKunder = Math.max(1, ...dagRaekke.map(d => d.kunder))

  const link = (p: { dage?: number; kunde?: string }) => {
    const q = new URLSearchParams()
    q.set('dage', String(p.dage ?? dage))
    if (p.kunde) q.set('kunde', p.kunde)
    return `/admin/portal-brug?${q}`
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Portal-brug</h1>
          <p className="mt-1 text-sm text-gray-500">
            Aktiv tid = minutter hvor kunden har fanen fremme og bruger den.
            {foerste?.dag && <> Logges siden {dagFmt.format(new Date(foerste.dag))}.</>}
            {' '}Admin &quot;som kunde&quot; tælles ikke med.
          </p>
        </div>
        <div className="flex gap-1">
          {PERIODER.map(p => (
            <a key={p} href={link({ dage: p, kunde })}
               className={`rounded-lg px-3 py-1.5 text-sm font-medium ${p === dage ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 ring-1 ring-gray-200 hover:bg-gray-50'}`}>
              {p} dage
            </a>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          ['Kunder på portalen', total.kunder, `${total.idag} i dag`],
          ['Brugere', total.brugere, 'login inkl. kontakter'],
          ['Aktiv tid i alt', varighed(total.sek), `snit ${total.kunder ? varighed(total.sek / total.kunder) : '0 min'} pr. kunde`],
          ['Sidevisninger', total.visninger.toLocaleString('da-DK'), `${aktiveKunder.length - ikkeSet.length} af ${aktiveKunder.length} aktive kunder`],
        ].map(([t, v, s]) => (
          <div key={String(t)} className="rounded-xl bg-white p-4 ring-1 ring-gray-200">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">{t}</p>
            <p className="mt-1 text-2xl font-bold tabular-nums text-gray-900">{v}</p>
            <p className="text-xs text-gray-500">{s}</p>
          </div>
        ))}
      </div>

      <div className="rounded-xl bg-white p-4 ring-1 ring-gray-200">
        <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500">Kunder pr. dag</p>
        <div className="flex h-32 items-end gap-[2px] overflow-x-auto">
          {dagRaekke.map(d => (
            <div key={d.dag} className="group flex min-w-[6px] flex-1 flex-col items-center justify-end"
                 title={`${dagFmt.format(new Date(d.dag))}: ${d.kunder} kunder · ${varighed(d.sek)}`}>
              <div className="w-full rounded-t bg-blue-500 group-hover:bg-blue-700"
                   style={{ height: `${(d.kunder / maxKunder) * 100}%`, minHeight: d.kunder ? 2 : 0 }} />
            </div>
          ))}
        </div>
        <div className="mt-1 flex justify-between text-[11px] text-gray-400">
          <span>{dagFmt.format(new Date(dagRaekke[0].dag))}</span>
          <span>maks {maxKunder} kunder/dag</span>
          <span>{dagFmt.format(new Date(dagRaekke[dagRaekke.length - 1].dag))}</span>
        </div>
      </div>

      {kunde && (
        <div className="rounded-xl bg-white ring-1 ring-blue-200">
          <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
            <p className="font-semibold text-gray-900">
              {kunder.find(k => k.kundeNr === kunde)?.navn ?? kunde} <span className="text-gray-400">({kunde})</span>
            </p>
            <a href={link({})} className="text-sm text-blue-600 hover:underline">Luk</a>
          </div>
          {detalje.length === 0 ? (
            <p className="px-4 py-6 text-sm text-gray-500">Ingen besøg i perioden.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                  <tr><th className="px-4 py-2">Dag</th><th className="px-4 py-2">Bruger</th><th className="px-4 py-2">Tid</th>
                      <th className="px-4 py-2 text-right">Aktiv</th><th className="px-4 py-2 text-right">Visninger</th><th className="px-4 py-2">Sider</th></tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {detalje.map((r, i) => (
                    <tr key={i}>
                      <td className="whitespace-nowrap px-4 py-2">{dagFmt.format(new Date(r.dag))}</td>
                      <td className="px-4 py-2">{r.brugerNavn}{r.erKontakt && <span className="ml-1 text-xs text-gray-400">(kontakt)</span>}
                        <div className="text-xs text-gray-400">{r.brugerEmail} · {r.enhed}</div></td>
                      <td className="whitespace-nowrap px-4 py-2 tabular-nums">{tidFmt.format(new Date(r.foersteBesoeg)).split(' ')[1]}–{tidFmt.format(new Date(r.sidsteBesoeg)).split(' ')[1]}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{varighed(r.sek)}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{r.visninger}</td>
                      <td className="px-4 py-2 text-xs text-gray-600">
                        {Object.entries(r.sider as Record<string, number>).sort((a, b) => b[1] - a[1])
                          .map(([s, n]) => `${SIDENAVNE[s] ?? s} ${n}`).join(' · ')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="overflow-hidden rounded-xl bg-white ring-1 ring-gray-200 lg:col-span-2">
          <p className="border-b border-gray-100 px-4 py-3 text-xs font-semibold uppercase tracking-wide text-gray-500">Pr. kunde</p>
          {kunder.length === 0 ? (
            <p className="px-4 py-6 text-sm text-gray-500">Ingen besøg endnu i perioden.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                  <tr><th className="px-4 py-2">Kunde</th><th className="px-4 py-2 text-right">Dage</th><th className="px-4 py-2 text-right">Aktiv tid</th>
                      <th className="px-4 py-2 text-right">Visninger</th><th className="px-4 py-2 text-right">Brugere</th><th className="px-4 py-2 text-right">Mobil</th><th className="px-4 py-2">Sidst set</th></tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {kunder.map(k => (
                    <tr key={k.kundeNr} className={k.kundeNr === kunde ? 'bg-blue-50' : 'hover:bg-gray-50'}>
                      <td className="px-4 py-2"><a href={link({ kunde: k.kundeNr })} className="font-medium text-gray-900 hover:text-blue-600">{k.navn || k.kundeNr}</a>
                        <span className="ml-1 text-xs text-gray-400">{k.kundeNr}</span></td>
                      <td className="px-4 py-2 text-right tabular-nums">{k.dage}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{varighed(k.sek)}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{k.visninger}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{k.brugere}</td>
                      <td className="px-4 py-2 text-right tabular-nums text-gray-500">{k.mobil}%</td>
                      <td className="whitespace-nowrap px-4 py-2 tabular-nums text-gray-500">{tidFmt.format(new Date(k.sidst))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="space-y-6">
          <div className="rounded-xl bg-white ring-1 ring-gray-200">
            <p className="border-b border-gray-100 px-4 py-3 text-xs font-semibold uppercase tracking-wide text-gray-500">Mest brugte sider</p>
            <ul className="divide-y divide-gray-100 text-sm">
              {sider.map(s => (
                <li key={s.sti} className="flex justify-between gap-2 px-4 py-2">
                  <span className="truncate">{SIDENAVNE[s.sti] ?? s.sti}</span>
                  <span className="shrink-0 tabular-nums text-gray-500">{s.antal} · {s.kunder} kunder</span>
                </li>
              ))}
              {sider.length === 0 && <li className="px-4 py-3 text-gray-500">Ingen data endnu.</li>}
            </ul>
          </div>

          <details className="rounded-xl bg-white ring-1 ring-gray-200">
            <summary className="cursor-pointer px-4 py-3 text-xs font-semibold uppercase tracking-wide text-gray-500">
              Ikke set i perioden ({ikkeSet.length})
            </summary>
            <ul className="max-h-96 divide-y divide-gray-100 overflow-y-auto text-sm">
              {ikkeSet.map(c => (
                <li key={c.bcCustomerNumber} className="flex justify-between gap-2 px-4 py-1.5">
                  <span className="truncate">{c.name}</span><span className="shrink-0 text-xs text-gray-400">{c.bcCustomerNumber}</span>
                </li>
              ))}
            </ul>
          </details>
        </div>
      </div>
    </div>
  )
}
