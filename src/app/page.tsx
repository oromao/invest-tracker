export default function HomePage() {
  return (
    <main className="min-h-screen bg-background flex flex-col items-center justify-center p-8">
      <div className="max-w-2xl w-full text-center">
        <h1 className="text-4xl font-bold mb-4">📈 InvestTracker</h1>
        <p className="text-muted-foreground text-lg mb-8">
          Seu portfólio de ações, FIIs, crypto e opções em um só lugar.
        </p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          {['Ações BR', 'Ações US', 'FIIs', 'Crypto', 'Opções', 'P&L Real', 'Alertas', 'IR'].map(f => (
            <div key={f} className="border rounded-lg p-3 text-center">
              {f}
            </div>
          ))}
        </div>
        <div className="mt-8">
          <a
            href="/login"
            className="inline-block bg-emerald-600 hover:bg-emerald-700 text-white px-6 py-3 rounded-lg font-medium transition-colors"
          >
            Entrar
          </a>
        </div>
      </div>
    </main>
  )
}
