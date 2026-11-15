import { getSalgsliste } from '@/lib/businesscentral'
import SalgslisteTabel from '@/components/admin/SalgslisteTabel'

export const dynamic = 'force-dynamic'

function todayCopenhagen(): string {
  // en-CA giver formatet YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Copenhagen' }).format(new Date())
}

// Næste hverdag efter iso (fredag → mandag), så "i dag og i morgen" også giver
// mening om fredagen, hvor næste afsendelse er mandag.
function nextWorkday(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`)
  do d.setUTCDate(d.getUTCDate() + 1)
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6)
  return d.toISOString().slice(0, 10)
}

function formatDanish(iso: string): string {
  const [y, m, d] = iso.split('-')
  if (!y || !m || !d) return iso
  return `${d}-${m}-${y}`
}

const ISO = /^\d{4}-\d{2}-\d{2}$/

export default async function SalgslistePage({
  searchParams,
}: {
  searchParams: { dato?: string; fra?: string; til?: string }
}) {
  const idag = todayCopenhagen()
  // ?dato= (gamle links) = én dag. Ellers fra..til, standard i dag + næste hverdag.
  const enkelt = ISO.test(searchParams.dato ?? '') ? (searchParams.dato as string) : ''
  const fra = enkelt || (ISO.test(searchParams.fra ?? '') ? (searchParams.fra as string) : idag)
  let til = enkelt || (ISO.test(searchParams.til ?? '') ? (searchParams.til as string) : nextWorkday(fra))
  if (til < fra) til = fra

  const rows = await getSalgsliste(fra, { tilDato: til })
  const datoTekst = fra === til ? formatDanish(fra) : `${formatDanish(fra)} – ${formatDanish(til)}`

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4 print:hidden">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Salgsliste</h1>
          <p className="mt-1 text-sm text-gray-500">
            Summeret salg pr. vare for afsendelse {datoTekst} (alle kunder) ·
            klik på en vare for kundesalg. Salg efter i dag er foldet ud.
          </p>
        </div>

        <form method="get" className="flex items-end gap-2">
          <label className="flex flex-col text-xs font-medium text-gray-500">
            Fra afsendelse
            <input
              type="date"
              name="fra"
              defaultValue={fra}
              className="mt-1 rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-900 focus:border-blue-500 focus:outline-none"
            />
          </label>
          <label className="flex flex-col text-xs font-medium text-gray-500">
            Til afsendelse
            <input
              type="date"
              name="til"
              defaultValue={til}
              className="mt-1 rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-900 focus:border-blue-500 focus:outline-none"
            />
          </label>
          <button
            type="submit"
            className="rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-blue-700"
          >
            Vis
          </button>
        </form>
      </div>

      <SalgslisteTabel key={`${fra}|${til}`} rows={rows} datoTekst={datoTekst} idag={idag} flereDage={fra !== til} />
    </div>
  )
}
