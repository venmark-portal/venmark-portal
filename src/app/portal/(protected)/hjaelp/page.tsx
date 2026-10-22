// Hjælpeside til kunderne: videoguide til bestilling.
//
// Videoen ligger på YouTube og ikke hos os. En videofil på serveren ville
// konkurrere med ordreafgivelse og skærmene om båndbredden, og vi skulle selv
// løse mobil, opløsninger og miniaturebilleder. Indlejret holder YouTube sine
// forslag inden for Venmarks egen kanal, så der ikke dukker konkurrenter op
// når videoen slutter.

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
      <h1 className="text-xl font-bold text-gray-900">{t('titel')}</h1>
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
