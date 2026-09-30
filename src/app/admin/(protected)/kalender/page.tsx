import { hentAftaler } from '@/lib/kalender'
import KalenderOversigt from '@/components/admin/KalenderOversigt'

export const dynamic = 'force-dynamic'

function dagStreng(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Copenhagen' }).format(d)
}

const erDato = (s?: string) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s)

export default async function KalenderPage({
  searchParams,
}: {
  searchParams: { fra?: string; maaneder?: string }
}) {
  const fra = erDato(searchParams.fra) ? searchParams.fra! : dagStreng(new Date())

  // Tre måneder frem som standard — det er horisonten Claus bad om.
  const antal = Math.min(12, Math.max(1, Number(searchParams.maaneder) || 3))
  const tilDato = new Date(`${fra}T12:00:00Z`)
  tilDato.setUTCMonth(tilDato.getUTCMonth() + antal)
  const til = tilDato.toISOString().slice(0, 10)

  const data = await hentAftaler(fra, til).catch(e => ({
    aftaler: [], personer: [], mangler: e instanceof Error ? e.message : String(e),
  }))

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <h1 className="text-xl font-bold text-gray-900">Kalender</h1>
      <p className="mt-1 text-sm text-gray-500">
        Aftaler fra alle Outlook-kalendere i huset, {antal} {antal === 1 ? 'måned' : 'måneder'} frem.
      </p>

      <div className="mt-5">
        <KalenderOversigt data={data} fra={fra} maaneder={antal} />
      </div>

      <p className="mt-6 text-xs leading-relaxed text-gray-500">
        Gentagne aftaler er foldet ud til de enkelte forekomster, så et ugentligt møde optræder
        hver uge og ikke kun den dag serien begyndte. Aftaler markeret «fri» er udeladt — de er
        typisk noget man har sat på sig selv og ikke noget andre skal forholde sig til.
        Delte postkasser og mødelokaler tæller med som «personer», fordi et booket lokale også
        er værd at kunne se.
      </p>
    </div>
  )
}
