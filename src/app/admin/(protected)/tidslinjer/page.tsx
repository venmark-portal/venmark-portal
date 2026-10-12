import { finansTidslinje, pakkeriTidslinje } from '@/lib/tidslinjer'
import { telefonTidslinje } from '@/lib/telefoni'
import Tidslinjer, { type TidslinjeSvar } from '@/components/admin/Tidslinjer'

export const dynamic = 'force-dynamic'

function idag(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Copenhagen' }).format(new Date())
}

function flytDage(iso: string, dage: number): string {
  const d = new Date(`${iso}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + dage)
  return d.toISOString().slice(0, 10)
}

const erDato = (s?: string) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s)

export default async function TidslinjerPage({
  searchParams,
}: {
  searchParams: { fra?: string; til?: string; dage?: string; job?: string }
}) {
  const til = erDato(searchParams.til) ? searchParams.til! : idag()

  // ?dage=30 er genvejsknapperne; ellers et eksplicit interval; ellers 30 dage.
  const antalDage = Number(searchParams.dage)
  const fra = Number.isFinite(antalDage) && antalDage > 0
    ? flytDage(til, -(antalDage - 1))
    : erDato(searchParams.fra) ? searchParams.fra! : flytDage(til, -29)

  const jobNr = /^\d+$/.test(searchParams.job ?? '') ? searchParams.job! : '16'

  // Hentes uafhængigt: BC kan svare dårligt på den ene uden at tage de andre med.
  const [finans, pakkeri, telefon] = await Promise.all([
    finansTidslinje(fra, til).catch(e => ({ fejl: e instanceof Error ? e.message : String(e) })),
    pakkeriTidslinje(fra, til, jobNr).catch(e => ({
      dage: [], pakkere: [], starter: null,
      fejl: e instanceof Error ? e.message : String(e),
    })),
    telefonTidslinje(fra, til).catch(e => ({
      dage: [], personer: [],
      fejl: e instanceof Error ? e.message : String(e),
    })),
  ])

  const data = { fra, til, finans, pakkeri, telefon } as TidslinjeSvar

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <h1 className="text-xl font-bold text-gray-900">Tidslinjer</h1>
      <p className="mt-1 text-sm text-gray-500">
        Dag for dag: hvad pakkeriet nåede, hvad telefonen bragte ind, og hvad der blev faktureret.
      </p>

      <div className="mt-5">
        <Tidslinjer data={data} fra={fra} til={til} />
      </div>

      <p className="mt-6 text-xs leading-relaxed text-gray-500">
        <strong>Om tallene.</strong> Omsætning er faktureret beløb ekskl. moms fra bogførte
        fakturalinjer; kreditnotaer indgår ikke, så det er fakturering og ikke nettoomsætning.
        Pakketallene kommer fra salgslinje-loggen, som først skriver fra 14-09-2026 — før den
        dato findes de ikke, fordi salgslinjerne blev slettet ved bogføring.
        Sammenligningen med sidste år er <strong>samme ugedag</strong> (52 uger tilbage), ikke
        samme dato — ugedagen afgør for meget i fisk til at 25/9 kan stilles op mod en torsdag.
        Samme dato står med i tabellen. Timer er stemplet tid på Dan-Time-job {jobNr}; de vises
        også pr. person for de pakkere der er koblet til deres BC-pakkerkode under
        Skærme → Medarbejdere. Mangler koblingen, står der en streg frem for et tal.
        Telefontallene er Teams-opkald hentet hver time. Personen er den der <em>tog</em>
        telefonen. Kom opkaldet gennem omstillingen, kan vi kun se hvem der tog det når
        beriget­ningen har nået det — den begyndte i august 2026, og omtrent halvdelen af
        hovednummer-opkaldene står derfor stadig som <strong>Ikke fordelt</strong> (grå).
        De tæller med i totalen, men kan ikke lægges på en medarbejder. Juni og juli er helt
        uden fordeling. Ubesvarede opkald tælles i dagens total og på ingen person.
      </p>
    </div>
  )
}
