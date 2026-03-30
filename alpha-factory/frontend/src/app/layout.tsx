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
    <html lang="pt-BR">
      <body className="overflow-x-hidden antialiased">
        <Providers>
          <Sidebar />
          <main className="min-h-screen min-w-0 p-4 pt-16 md:ml-[18rem] md:p-8 md:pt-8">
            {children}
          </main>
        </Providers>
      </body>
    </html>
  )
}
