import { prisma } from '@/lib/prisma'
import { ensureRobotSkema } from '@/lib/robot/db'
import { hentViden } from '@/lib/robot/viden'
import { gemViden, sletViden } from '../actions'

export const dynamic = 'force-dynamic'

// Robot-viden: alt robotten ved om Venmark, som den ikke kan slå op i BC. Hvert punkt
// læses ind i robottens instruks ved næste spørgsmål (højst 1 minuts forsinkelse).
// ?fra=<svar-id> åbner en ny viden udfyldt med et spørgsmål og svar fra en samtale.

const tid = (d: Date) => d.toLocaleString('da-DK', { timeZone: 'Europe/Copenhagen', day: '2-digit', month: '2-digit', year: 'numeric' })

export default async function RobotVidenPage({ searchParams }: { searchParams?: { fra?: string } }) {
  await ensureRobotSkema()
  const punkter = await hentViden()

  // Forslag fra en samtale: kundens spørgsmål som emne, robottens svar som tekst.
  let forslag: { beskedId: number; emne: string; tekst: string; daarligt: boolean } | null = null
  const fra = Number(searchParams?.fra ?? 0)
  if (fra > 0) {
    const rows = await prisma.$queryRaw<{ tekst: string; spoergsmaal: string | null; kundeVurdering: number | null; kontorVurdering: number | null }[]>`
      SELECT b.tekst, b."kundeVurdering", b."kontorVurdering",
             (SELECT k.tekst FROM "RobotBesked" k WHERE k."samtaleId" = b."samtaleId" AND k.id < b.id AND k.rolle = 'kunde'
              ORDER BY k.id DESC LIMIT 1) AS spoergsmaal
      FROM "RobotBesked" b WHERE b.id = ${fra} AND b.rolle = 'robot'
    `
    if (rows[0]) {
      const daarligt = rows[0].kontorVurdering === -1 || (rows[0].kontorVurdering == null && rows[0].kundeVurdering === -1)
      forslag = {
        beskedId: fra,
        emne: (rows[0].spoergsmaal ?? '').slice(0, 200),
        // Et dårligt svar skal ikke gentages — så starter feltet tomt.
        tekst: daarligt ? '' : rows[0].tekst,
        daarligt,
      }
    }
  }

  const aktive = punkter.filter(p => p.aktiv).length

  return (
    <div className="space-y-6">
      <div>
        <a href="/admin/robot" className="text-sm text-blue-600 hover:underline">← Svar-robot</a>
        <h1 className="mt-1 text-2xl font-bold text-gray-900">Robot-viden</h1>
        <p className="mt-1 max-w-3xl text-sm text-gray-500">
          Det robotten ved om Venmark og ikke kan slå op i BC: kontakt, fragt, reklamation, betaling, leverandører,
          varenavne (&quot;Bakka = Bakkafrost fra Færøerne&quot;) osv. Skriv kort og konkret, som du ville svare en kunde i telefonen.
          Priser, lager, ordrer og leveringsdage skal IKKE stå her — dem slår robotten op live.
          Ændringer gælder fra næste spørgsmål. {aktive} aktive punkter.
        </p>
      </div>

      <section className={'rounded-xl border p-4 ' + (forslag ? 'border-blue-300 bg-blue-50/40' : 'border-gray-200 bg-white')}>
        <h2 className="text-base font-semibold text-gray-900">{forslag ? 'Gem fra samtale' : 'Ny viden'}</h2>
        {forslag?.daarligt && (
          <p className="mt-1 text-sm text-red-800">Svaret blev vurderet dårligt. Skriv det rigtige svar, så robotten svarer sådan næste gang.</p>
        )}
        <form action={gemViden} className="mt-3 space-y-2">
          {forslag && <input type="hidden" name="beskedId" value={forslag.beskedId} />}
          <label htmlFor="viden-ny-emne" className="block text-xs font-medium text-gray-600">Emne / spørgsmål</label>
          <input id="viden-ny-emne" name="emne" defaultValue={forslag?.emne ?? ''} required maxLength={200}
            placeholder="Fx: Laks fra Bakka" className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
          <label htmlFor="viden-ny-tekst" className="block text-xs font-medium text-gray-600">Svar / viden</label>
          <textarea id="viden-ny-tekst" name="tekst" defaultValue={forslag?.tekst ?? ''} required rows={forslag ? 8 : 4}
            placeholder="Fx: Bakka er Bakkafrost fra Færøerne. Varerne hedder 'Færøsk laks … BAKKA' i sortimentet."
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
          <button className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">Gem viden</button>
        </form>
      </section>

      <section className="space-y-2">
        {punkter.map(p => (
          <details key={p.id} className={'rounded-xl border bg-white p-3 ' + (p.aktiv ? 'border-gray-200' : 'border-dashed border-gray-300 opacity-60')}>
            <summary className="cursor-pointer">
              <span className="font-medium text-gray-900">{p.emne}</span>
              {!p.aktiv && <span className="ml-2 rounded bg-gray-100 px-1.5 text-xs text-gray-600">slået fra</span>}
              <span className="ml-2 text-xs text-gray-400">
                {p.kilde === 'faq-fil' ? 'fra FAQ' : p.kilde === 'samtale' ? 'fra samtale' : 'manuel'} · {p.oprettetAf ?? ''} · rettet {tid(p.updatedAt)}
              </span>
              <span className="block truncate text-sm text-gray-500">{p.tekst.split('\n')[0]}</span>
            </summary>
            <form action={gemViden} className="mt-3 space-y-2">
              <input type="hidden" name="id" value={p.id} />
              <input type="hidden" name="harAktiv" value="1" />
              <label htmlFor={`viden-${p.id}-emne`} className="sr-only">Emne</label>
              <input id={`viden-${p.id}-emne`} name="emne" defaultValue={p.emne} required maxLength={200}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium" />
              <label htmlFor={`viden-${p.id}-tekst`} className="sr-only">Tekst</label>
              <textarea id={`viden-${p.id}-tekst`} name="tekst" defaultValue={p.tekst} required
                rows={Math.min(16, Math.max(3, p.tekst.split('\n').length + 1))}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
              <div className="flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-1.5 text-sm text-gray-700">
                  <input id={`viden-${p.id}-aktiv`} type="checkbox" name="aktiv" value="1" defaultChecked={p.aktiv} /> Aktiv
                </label>
                <button className="rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700">Gem</button>
              </div>
            </form>
            <form action={sletViden} className="mt-2">
              <input type="hidden" name="id" value={p.id} />
              <button className="text-xs text-gray-400 hover:text-red-600">Slet punktet</button>
            </form>
          </details>
        ))}
      </section>
    </div>
  )
}
