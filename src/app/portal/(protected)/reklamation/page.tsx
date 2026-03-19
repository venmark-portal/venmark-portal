import ReklamationForm from './ReklamationForm'

export default function ReklamationPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Reklamation</h1>
        <p className="mt-1 text-sm text-gray-500">Beskriv problemet og vedhæft evt. billeder</p>
      </div>
      <ReklamationForm />
    </div>
  )
}
