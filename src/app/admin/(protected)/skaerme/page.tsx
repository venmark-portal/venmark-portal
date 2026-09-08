import { headers } from 'next/headers'
import SkaermeAdmin from '@/components/admin/SkaermeAdmin'

export const dynamic = 'force-dynamic'

export default function SkaermePage() {
  // URL'en skal kunne kopieres direkte ind i skærmens browser, så den skal være
  // absolut — og bag Caddy er host/proto det eneste sted den står rigtigt.
  const h     = headers()
  const proto = h.get('x-forwarded-proto') ?? 'https'
  const host  = h.get('host') ?? 'portal.venmark.dk'

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Info-skærme</h1>
        <p className="mt-1 text-sm text-gray-500">
          Hver skærm åbner sin egen URL og kører videre af sig selv. Grøn prik = skærmen har
          meldt sig i live inden for de sidste 2 minutter. Ændringer slår igennem på skærmen
          inden for et halvt minut — den skal ikke genstartes.
        </p>
      </div>

      <SkaermeAdmin baseUrl={`${proto}://${host}`} />
    </div>
  )
}
