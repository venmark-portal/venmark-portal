import type { Metadata } from 'next'
import { MapPin, Phone, Mail, Award, Truck, Fish, Factory } from 'lucide-react'

export const metadata: Metadata = {
  title: 'Om os — Venmark Fisk A/S',
  description:
    'Venmark Fisk A/S er en landsdækkende fiskeleverandør med egen opskæring, farsproduktion, røgeri og salatproduktion. Leverer til fiskeforhandlere, restauranter og cateringvirksomheder.',
}

const features = [
  {
    icon: Fish,
    title: 'Frisk fisk dagligt',
    text: 'Vi indkøber frisk fisk direkte fra auktionerne hver dag, så du altid får det bedste og friskeste sortiment.',
  },
  {
    icon: Factory,
    title: 'Egen produktion',
    text: 'Røgeri, opskæring, farsproduktion og salatproduktion — alt under ét tag i Hirtshals.',
  },
  {
    icon: Truck,
    title: 'Landsdækkende levering',
    text: 'Vi leverer til fiskeforhandlere, restauranter, supermarkeder og cateringvirksomheder over hele Danmark.',
  },
  {
    icon: Award,
    title: 'Kvalitet og fødevaresikkerhed',
    text: 'Vi arbejder efter de højeste standarder for fødevaresikkerhed og hygiejne, og dokumenterer det løbende.',
  },
]

const timeline = [
  {
    year: '1997',
    title: 'Grundlagt i Hirtshals',
    text: 'Brødrene Henrik og Claus Ibsen starter Venmark Fisk i en nedlagt slagterforretning i Vestergade, Hirtshals. Herfra leveres frisk fisk direkte fra auktionen til supermarkeder og restauranter.',
  },
  {
    year: '2003',
    title: 'Flytning til havnen',
    text: 'De gamle slagterlokaler er for små. Venmark rykker til Læssevej på Havnen i Hirtshals og udvider med salg til landets fiskehandlere og egenproduktion i form af opskæring af fladfisk.',
  },
  {
    year: '2010',
    title: 'Eksport og vækst',
    text: 'Venmark begynder eksportsalg og vokser til at blive en af Danmarks ledende fiskegrossister med kunder i hele Skandinavien og Europa.',
  },
  {
    year: '2016',
    title: 'Nyt domicil på Søndergade',
    text: 'De tidligere mejerilokaliteter på Søndergade 50 i Hirtshals ombygges og bliver Venmarks nye hovedkvarter — med plads til opskæring, frys- og tørvarelager, pakkefaciliteter og daglige fragtafgange.',
  },
]

const locations = [
  {
    label: 'Produktion & Hovedkontor',
    address: 'Søndergade 50',
    city: '9850 Hirtshals',
    mapsUrl: 'https://maps.google.com/?q=Søndergade+50,+9850+Hirtshals',
  },
  {
    label: 'Distributionscenter',
    address: 'Bådehavnsgade 48',
    city: '2450 København SV',
    mapsUrl: 'https://maps.google.com/?q=Bådehavnsgade+48,+2450+København+SV',
  },
]

export default function OmOsPage() {
  return (
    <div className="mx-auto max-w-screen-xl px-4 py-12">

      {/* ── Hero ── */}
      <div className="mb-16 max-w-3xl">
        <p className="mb-3 text-sm font-semibold uppercase tracking-widest text-brand-600">
          Om Venmark Fisk A/S
        </p>
        <h1 className="mb-5 text-3xl font-bold leading-tight text-steel-900 sm:text-4xl">
          Danmarks ledende<br className="hidden sm:block" /> fiskegrossist siden 1997
        </h1>
        <p className="text-lg leading-relaxed text-steel-600">
          Med næsten 30 års erfaring inden for fisk engros leverer vi det bedste fra havet
          til fiskehandlere, restauranter, supermarkeder og storkøkkener i hele Danmark og Europa.
          Vi indkøber dagligt fra de danske fiskeauktioner samt fra samarbejdspartnere i bl.a. Island
          — og har vores eget røgeri, opskæring og produktion i Hirtshals.
        </p>
      </div>

      {/* ── Features ── */}
      <div className="mb-16 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {features.map((f) => (
          <div
            key={f.title}
            className="rounded-xl border border-steel-200 bg-white p-6 shadow-sm"
          >
            <div className="mb-4 inline-flex rounded-lg bg-brand-50 p-3">
              <f.icon className="text-brand-600" size={22} />
            </div>
            <h2 className="mb-2 font-semibold text-steel-800">{f.title}</h2>
            <p className="text-sm leading-relaxed text-steel-500">{f.text}</p>
          </div>
        ))}
      </div>

      {/* ── Tal / nøglefakta ── */}
      <div className="mb-16 rounded-2xl bg-brand-600 px-8 py-10 text-white">
        <h2 className="mb-8 text-center text-xl font-semibold">Venmark i tal</h2>
        <div className="grid grid-cols-2 gap-8 text-center sm:grid-cols-4">
          {[
            { value: '1997', label: 'Grundlagt' },
            { value: '2', label: 'Lokationer' },
            { value: '365', label: 'Dage om året' },
            { value: '∞', label: 'Friske produkter' },
          ].map((stat) => (
            <div key={stat.label}>
              <p className="text-4xl font-bold">{stat.value}</p>
              <p className="mt-1 text-sm text-brand-200">{stat.label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* ── Vores historie (tidslinje) ── */}
      <div className="mb-16">
        <h2 className="mb-10 text-2xl font-bold text-steel-900">Vores historie</h2>
        <div className="relative border-l-2 border-brand-200 pl-8 space-y-10">
          {timeline.map((item) => (
            <div key={item.year} className="relative">
              {/* Tidslinje-prik */}
              <span className="absolute -left-[41px] flex h-5 w-5 items-center justify-center rounded-full bg-brand-600 ring-4 ring-white">
                <span className="h-2 w-2 rounded-full bg-white" />
              </span>
              <p className="mb-1 text-xs font-bold uppercase tracking-widest text-brand-500">
                {item.year}
              </p>
              <h3 className="mb-1.5 text-base font-semibold text-steel-800">{item.title}</h3>
              <p className="text-sm leading-relaxed text-steel-500 max-w-2xl">{item.text}</p>
            </div>
          ))}
        </div>
      </div>

      {/* ── Hvem leverer vi til? ── */}
      <div className="mb-16 rounded-2xl bg-steel-50 px-8 py-10">
        <h2 className="mb-6 text-xl font-bold text-steel-900">Hvem leverer vi til?</h2>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {[
            { emoji: '🍽️', label: 'Restauranter' },
            { emoji: '🏪', label: 'Supermarkeder' },
            { emoji: '🐟', label: 'Fiskehandlere' },
            { emoji: '🍱', label: 'Storkøkkener & catering' },
          ].map((c) => (
            <div
              key={c.label}
              className="rounded-xl bg-white border border-steel-200 p-5 text-center shadow-sm"
            >
              <p className="text-3xl mb-2">{c.emoji}</p>
              <p className="text-sm font-medium text-steel-700">{c.label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* ── Lokationer + kontakt ── */}
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">

        {/* Lokationer */}
        <div>
          <h2 className="mb-6 text-xl font-bold text-steel-800">Vores lokationer</h2>
          <div className="flex flex-col gap-4">
            {locations.map((loc) => (
              <a
                key={loc.label}
                href={loc.mapsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-start gap-4 rounded-xl border border-steel-200 bg-white p-5 shadow-sm transition hover:border-brand-400 hover:shadow-md"
              >
                <div className="mt-0.5 rounded-lg bg-brand-50 p-2.5">
                  <MapPin className="text-brand-600" size={20} />
                </div>
                <div>
                  <p className="font-semibold text-steel-800">{loc.label}</p>
                  <p className="text-sm text-steel-500">{loc.address}</p>
                  <p className="text-sm text-steel-500">{loc.city}</p>
                </div>
              </a>
            ))}
          </div>
        </div>

        {/* Kontakt */}
        <div>
          <h2 className="mb-6 text-xl font-bold text-steel-800">Kontakt os</h2>
          <div className="flex flex-col gap-4">
            <a
              href="tel:+4598945965"
              className="flex items-center gap-4 rounded-xl border border-steel-200 bg-white p-5 shadow-sm transition hover:border-brand-400 hover:shadow-md"
            >
              <div className="rounded-lg bg-green-50 p-2.5">
                <Phone className="text-green-600" size={20} />
              </div>
              <div>
                <p className="text-xs text-steel-400">Telefon</p>
                <p className="font-semibold text-steel-800">+45 9894 5965</p>
              </div>
            </a>

            <a
              href="mailto:fisk@venmark.dk"
              className="flex items-center gap-4 rounded-xl border border-steel-200 bg-white p-5 shadow-sm transition hover:border-brand-400 hover:shadow-md"
            >
              <div className="rounded-lg bg-blue-50 p-2.5">
                <Mail className="text-blue-600" size={20} />
              </div>
              <div>
                <p className="text-xs text-steel-400">E-mail</p>
                <p className="font-semibold text-steel-800">fisk@venmark.dk</p>
              </div>
            </a>

            <div className="rounded-xl border border-steel-200 bg-white p-5 shadow-sm">
              <p className="mb-3 text-sm font-semibold text-steel-700">Firmaoplysninger</p>
              <dl className="space-y-1 text-sm text-steel-500">
                <div className="flex justify-between">
                  <dt>Fuldt navn</dt>
                  <dd className="font-medium text-steel-700">Venmark Fisk A/S</dd>
                </div>
                <div className="flex justify-between">
                  <dt>CVR-nr.</dt>
                  <dd className="font-medium text-steel-700">33050151</dd>
                </div>
                <div className="flex justify-between">
                  <dt>Hjemsted</dt>
                  <dd className="font-medium text-steel-700">Hirtshals</dd>
                </div>
              </dl>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
