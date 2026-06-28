import { getSalgsliste } from '@/lib/businesscentral'
import SalgslisteTabel from '@/components/admin/SalgslisteTabel'

export const dynamic = 'force-dynamic'

function todayCopenhagen(): string {
  // en-CA giver formatet YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Copenhagen' }).format(new Date())
}

function formatDanish(iso: string): string {
  const [y, m, d] = iso.split('-')
  if (!y || !m || !d) return iso
  return `${d}-${m}-${y}`
}

export default async function SalgslistePage({
  searchParams,
}: {
  searchParams: { dato?: string }
}) {
  const dato = /^\d{4}-\d{2}-\d{2}$/.test(searchParams.dato ?? '')
    ? (searchParams.dato as string)
    : todayCopenhagen()

  const rows = await getSalgsliste(dato)

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Salgsliste</h1>
          <p className="mt-1 text-sm text-gray-500">
            Summeret salg pr. vare for afsendelsesdato {formatDanish(dato)} (alle kunder) ·
            klik på en vare for kundesalg.
          </p>
        </div>

        <form method="get" className="flex items-end gap-2">
          <label className="flex flex-col text-xs font-medium text-gray-500">
            Afsendelsesdato
            <input
              type="date"
              name="dato"
              defaultValue={dato}
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

      <SalgslisteTabel rows={rows} />
    </div>
  )
}
