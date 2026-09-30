import ReklamationForm from './ReklamationForm'

export default function ReklamationPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Reklamation</h1>
        <p className="mt-1 text-sm text-gray-500">Beskriv problemet og vedhæft evt. billeder</p>
      </div>

      {/* Fejl på selve siden har ingen anden vej ind til os. Kunden opdager dem,
          men tænker ikke på at "reklamation" også dækker det — så det skal stå. */}
      <div className="rounded-xl bg-blue-50 px-4 py-3 text-sm text-blue-900 ring-1 ring-blue-200">
        <strong>Du må også gerne skrive om fejl og mangler på hjemmesiden.</strong>{' '}
        Virker noget ikke som det skal, mangler der en vare, eller er der noget der er
        besværligt — så sig til her. Vi retter det.
      </div>
      <ReklamationForm />
    </div>
  )
}
