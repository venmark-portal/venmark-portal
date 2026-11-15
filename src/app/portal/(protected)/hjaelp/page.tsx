// Hjælpeside til kunderne: videoguide til bestilling.
//
// Videoen ligger på YouTube og ikke hos os. En videofil på serveren ville
// konkurrere med ordreafgivelse og skærmene om båndbredden, og vi skulle selv
// løse mobil, opløsninger og miniaturebilleder. Indlejret holder YouTube sine
// forslag inden for Venmarks egen kanal, så der ikke dukker konkurrenter op
// når videoen slutter.

// Siden hedder "Support og vejledning" i menuen (Claus 08-11-2026), og Claus' direkte nummer
// står øverst her i stedet for på forsiden.

import { Phone } from 'lucide-react'
import { getT } from '@/lib/i18n/portal/server'
import { hjaelpDict } from '@/lib/i18n/portal/dict/hjaelp'

export async function generateMetadata() {
  const t = await getT(hjaelpDict)
  return { title: t('metaTitel') }
}

const VIDEO_ID = 'XAG5U-bXOxQ'

export default async function HjaelpPage() {
  const t = await getT(hjaelpDict)
  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <h1 className="text-xl font-bold text-gray-900">{t('sideTitel')}</h1>

      {/* Hotline — Claus' direkte nummer (Claus 22-10-2026). tel:-link så mobilkunder ringer med ét tryk. */}
      <div className="mt-4 flex flex-col gap-3 rounded-xl bg-white px-5 py-4 shadow-sm ring-1 ring-gray-200 sm:flex-row sm:items-center">
        <div className="flex items-center gap-4">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-green-50 text-green-700">
            <Phone size={22} />
          </span>
          <div>
            <div className="font-semibold text-gray-900">{t('hotlineTitel')}</div>
            <div className="text-sm text-gray-500">{t('hotlineTekst')}</div>
          </div>
        </div>
        <a
          href="tel:+4541969644"
          className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg bg-green-600 px-4 py-2.5 text-base font-semibold text-white hover:bg-green-700 sm:ml-auto"
        >
          <Phone size={18} /> {t('hotlineNummer')}
        </a>
      </div>

      <h2 className="mt-8 text-lg font-bold text-gray-900">{t('titel')}</h2>
      <p className="mt-1 text-sm text-gray-500">
        {t('intro')}
      </p>

      <div className="mt-5 overflow-hidden rounded-xl bg-black shadow-sm ring-1 ring-gray-200">
        {/* 16:9 uanset skærmbredde. padding-bottom-kneb frem for aspect-ratio,
            så den også holder i ældre browsere på kundernes maskiner. */}
        <div className="relative h-0" style={{ paddingBottom: '56.25%' }}>
          <iframe
            className="absolute inset-0 h-full w-full"
            src={`https://www.youtube-nocookie.com/embed/${VIDEO_ID}`}
            title={t('videoTitel')}
            allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowFullScreen
          />
        </div>
      </div>

      <div className="mt-6 rounded-xl bg-white p-5 ring-1 ring-gray-200">
        <h2 className="text-sm font-semibold text-gray-900">{t('komIGang')}</h2>
        <ul className="mt-3 space-y-2 text-sm text-gray-700">
          <li><strong>{t('soegB')}</strong> {t('soegT')}</li>
          <li><strong>{t('kurvB')}</strong> {t('kurvT')}</li>
          <li><strong>{t('levB')}</strong> {t('levT')}</li>
          <li><strong>{t('favB')}</strong> {t('favT')}</li>
        </ul>
        <p className="mt-4 text-sm text-gray-500">
          {t('drillerFoer')} <a href="tel:+4598945965" className="text-blue-600 hover:underline">{t('telefon')}</a>{' '}
          {t('drillerMidt')} <a href="/portal/beskeder" className="text-blue-600 hover:underline">{t('beskeder')}</a>{t('drillerEfter')}
        </p>
      </div>
    </div>
  )
}
