import ReklamationForm from './ReklamationForm'
import { getT } from '@/lib/i18n/portal/server'
import { reklamationDict } from '@/lib/i18n/portal/dict/reklamation'

export default async function ReklamationPage() {
  const t = await getT(reklamationDict)
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">{t('titel')}</h1>
        <p className="mt-1 text-sm text-gray-500">{t('intro')}</p>
      </div>

      {/* Fejl på selve siden har ingen anden vej ind til os. Kunden opdager dem,
          men tænker ikke på at "reklamation" også dækker det — så det skal stå. */}
      <div className="rounded-xl bg-blue-50 px-4 py-3 text-sm text-blue-900 ring-1 ring-blue-200">
        <strong>{t('hjemmesideFed')}</strong>{' '}
        {t('hjemmesideTekst')}
      </div>
      <ReklamationForm />
    </div>
  )
}
