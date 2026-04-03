import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Chauffør | Venmark',
}

export default function ChauffeurLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-50">
      {children}
    </div>
  )
}
