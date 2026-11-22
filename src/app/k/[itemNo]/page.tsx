// Kanban-siden: det man lander på, når man scanner QR-koden på en hylde-label.
//
// Adressen er kort med vilje — /k/79533. En QR-kode med en lang adresse bliver tæt,
// og en tæt kode skal holdes stille tæt på for at blive læst. Det her skal kunne
// scannes med en hånd fuld af kasser.
//
// Siden SKRIVER IKKE ved indlæsning. Den viser varen og venter på et tryk. Ellers
// kunne et tilfældigt scan — eller en linkforhåndsvisning i en besked — melde en
// hylde tom, uden at nogen havde ment det.

import { aabentSignal, hentVare } from '@/lib/kanban'
import Meld, { type Meldt } from './Meld'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const metadata = { title: 'Tom hylde | Venmark' }

export default async function KanbanSide({ params }: { params: { itemNo: string } }) {
  const itemNo = decodeURIComponent(params.itemNo).trim().toUpperCase()

  const [vare, signal] = await Promise.all([
    hentVare(itemNo).catch(() => null),
    aabentSignal(itemNo).catch(() => null),
  ])

  if (!vare) {
    return (
      <main className="flex min-h-[100dvh] flex-col items-center justify-center gap-4 bg-gray-100 p-6 text-center">
        <p className="text-5xl">🤔</p>
        <h1 className="text-2xl font-bold text-gray-900">Varenummer {itemNo} findes ikke</h1>
        <p className="max-w-sm text-gray-600">
          Tjek koden på labelen. Står nummeret rigtigt, er varen måske slettet i Business Central.
        </p>
      </main>
    )
  }

  const meldt: Meldt | null = signal
    ? { lastAt: signal.lastAt.toISOString(), meldtAf: signal.meldtAf, antal: signal.antal }
    : null

  return (
    <main className="flex min-h-[100dvh] flex-col bg-gray-100">
      <div className="flex flex-1 flex-col gap-5 p-5 pt-8">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wide text-gray-500">Tom hylde</p>
          <h1 className="mt-1 text-3xl font-bold leading-tight text-gray-900">{vare.description}</h1>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-gray-500">{vare.itemNo}</p>
        </div>

        <dl className="grid grid-cols-2 gap-3">
          <Felt navn="Tælles i" vaerdi={vare.baseUom || '—'} />
          <Felt
            navn="På lager i BC"
            vaerdi={
              vare.inventory === null
                ? '—'
                : `${vare.inventory.toLocaleString('da-DK', { maximumFractionDigits: 3 })} ${vare.baseUom}`
            }
          />
        </dl>

        <Meld itemNo={vare.itemNo} alleredeMeldt={meldt} />
      </div>
    </main>
  )
}

function Felt({ navn, vaerdi }: { navn: string; vaerdi: string }) {
  return (
    <div className="rounded-xl bg-white p-3 ring-1 ring-gray-200">
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">{navn}</dt>
      <dd className="mt-0.5 text-lg font-semibold text-gray-900">{vaerdi}</dd>
    </div>
  )
}
