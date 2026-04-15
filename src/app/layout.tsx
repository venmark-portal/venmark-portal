import type { Metadata } from 'next'
import './globals.css'
import NavHeader from '@/components/NavHeader'
import FooterConditional from '@/components/FooterConditional'

export const metadata: Metadata = {
  title: 'Venmark.dk — Industrielt varekatalog',
  description:
    'Professionelt varekatalog med direkte kobling til Business Central. Find varer, priser og lagerstatus.',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="da">
      <body className="min-h-screen flex flex-col">
        <NavHeader />
        <main className="flex-1">
          {children}
        </main>
        <FooterConditional />
      </body>
    </html>
  )
}
