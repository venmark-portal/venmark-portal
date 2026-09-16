import AuktionManager from '@/components/admin/AuktionManager'

export const dynamic = 'force-dynamic'

export default function AuktionerAdminPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Auktioner</h1>
        <p className="mt-1 text-sm text-gray-500">Opret og styr auktioner på kundeportalen. Kun kreditgodkendte kunder kan byde.</p>
      </div>
      <AuktionManager />
    </div>
  )
}
