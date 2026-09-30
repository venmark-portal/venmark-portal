// Hjælpeside til kunderne: videoguide til bestilling.
//
// Videoen ligger på YouTube og ikke hos os. En videofil på serveren ville
// konkurrere med ordreafgivelse og skærmene om båndbredden, og vi skulle selv
// løse mobil, opløsninger og miniaturebilleder. Indlejret holder YouTube sine
// forslag inden for Venmarks egen kanal, så der ikke dukker konkurrenter op
// når videoen slutter.

export const metadata = { title: 'Hjælp — Venmark' }

const VIDEO_ID = 'XAG5U-bXOxQ'

export default function HjaelpPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <h1 className="text-xl font-bold text-gray-900">Sådan bestiller du</h1>
      <p className="mt-1 text-sm text-gray-500">
        En gennemgang af bestillingssiden — fra søgning til afsendt ordre.
      </p>

      <div className="mt-5 overflow-hidden rounded-xl bg-black shadow-sm ring-1 ring-gray-200">
        {/* 16:9 uanset skærmbredde. padding-bottom-kneb frem for aspect-ratio,
            så den også holder i ældre browsere på kundernes maskiner. */}
        <div className="relative h-0" style={{ paddingBottom: '56.25%' }}>
          <iframe
            className="absolute inset-0 h-full w-full"
            src={`https://www.youtube-nocookie.com/embed/${VIDEO_ID}`}
            title="Venmark Fisk web bestillings guide"
            allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowFullScreen
          />
        </div>
      </div>

      <div className="mt-6 rounded-xl bg-white p-5 ring-1 ring-gray-200">
        <h2 className="text-sm font-semibold text-gray-900">Kom hurtigt i gang</h2>
        <ul className="mt-3 space-y-2 text-sm text-gray-700">
          <li><strong>Søgefeltet</strong> ligger øverst på bestillingssiden og er der hele tiden — første bogstav åbner søgningen.</li>
          <li><strong>Kurven</strong> følger med ned ad siden, så du altid kan se hvad du har valgt.</li>
          <li><strong>Leveringsdatoen</strong> vælges før varerne. Bestiller du til i morgen eller senere, kan prisen på auktionsfisk nå at ændre sig — skriv din maks. pris i bemærkningsfeltet.</li>
          <li><strong>Favoritter</strong> står øverst, så det du plejer at købe er det første du ser.</li>
        </ul>
        <p className="mt-4 text-sm text-gray-500">
          Er der noget der driller, så ring til os på <a href="tel:+4598945965" className="text-blue-600 hover:underline">98 94 59 65</a> eller
          skriv en besked under <a href="/portal/beskeder" className="text-blue-600 hover:underline">Beskeder</a>.
        </p>
      </div>
    </div>
  )
}
