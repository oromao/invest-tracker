import type { Metadata } from 'next'
import './globals.css'
import { Providers } from '@/components/providers'
import { Sidebar } from '@/components/sidebar'

export const metadata: Metadata = {
  title: 'Alpha Factory',
  description: 'Autonomous Signal Engine',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>
        <Providers>
          <Sidebar />
          <main className="md:ml-56 min-h-screen p-4 md:p-6 pt-16 md:pt-6">
            {children}
          </main>
        </Providers>
      </body>
    </html>
  )
}
