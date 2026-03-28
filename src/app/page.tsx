import { auth } from '@/lib/auth'
import { redirect } from 'next/navigation'
import Link from 'next/link'

export default async function HomePage() {
  const session = await auth()
  if (session?.user) redirect('/dashboard')

  return (
    <main className="min-h-screen bg-[#0a0a0a] flex flex-col items-center justify-center p-8">
      <div className="max-w-2xl w-full text-center">
        <div className="inline-flex items-center justify-center w-16 h-16 bg-blue-600/20 border border-blue-500/30 rounded-2xl mb-6">
          <svg className="w-8 h-8 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
          </svg>
        </div>
        <h1 className="text-4xl font-bold text-white mb-3">InvestTracker</h1>
        <p className="text-white/50 text-lg mb-10">
          Seu portfólio de ações, FIIs, crypto e opções em um só lugar.
        </p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm mb-10">
          {['Ações BR', 'Ações US', 'FIIs', 'Crypto', 'Opções', 'P&L Real', 'Alertas', 'Relatório IR'].map(f => (
            <div key={f} className="border border-white/10 bg-white/5 rounded-lg p-3 text-white/60">
              {f}
            </div>
          ))}
        </div>
        <div className="flex items-center justify-center gap-4">
          <Link
            href="/login"
            className="inline-block bg-white/10 hover:bg-white/15 text-white px-6 py-3 rounded-lg font-medium transition-colors border border-white/10"
          >
            Entrar
          </Link>
          <Link
            href="/register"
            className="inline-block bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-lg font-medium transition-colors"
          >
            Criar conta grátis
          </Link>
        </div>
      </div>
    </main>
  )
}
