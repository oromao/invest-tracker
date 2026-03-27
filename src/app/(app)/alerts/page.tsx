'use client'

export default function AlertsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Alertas</h1>
        <p className="text-white/50 text-sm mt-1">Notificações de preço e variação</p>
      </div>

      <div className="flex flex-col items-center justify-center min-h-[400px] text-center">
        <div className="w-20 h-20 bg-yellow-500/10 border border-yellow-500/20 rounded-2xl flex items-center justify-center mb-6">
          <svg
            className="w-10 h-10 text-yellow-400"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
            />
          </svg>
        </div>

        <div className="bg-[#111] border border-white/10 rounded-2xl px-8 py-6 max-w-md w-full">
          <div className="inline-flex items-center gap-2 bg-yellow-500/10 border border-yellow-500/20 text-yellow-400 text-xs font-medium px-3 py-1 rounded-full mb-4">
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            Em breve
          </div>

          <h2 className="text-xl font-bold text-white mb-3">Alertas de Preço</h2>
          <p className="text-white/50 text-sm leading-relaxed mb-6">
            Em breve você poderá configurar alertas automáticos para seus ativos.
            Seja notificado quando um ativo atingir determinado preço ou variação percentual.
          </p>

          <div className="space-y-3 text-left">
            {[
              { icon: '📈', text: 'Alerta quando ativo ultrapassar preço alvo' },
              { icon: '📉', text: 'Alerta quando ativo cair abaixo de suporte' },
              { icon: '📊', text: 'Alerta por variação percentual' },
              { icon: '🔔', text: 'Notificações em tempo real' },
            ].map((feature) => (
              <div
                key={feature.text}
                className="flex items-center gap-3 py-2 border-b border-white/5 last:border-0"
              >
                <span className="text-base">{feature.icon}</span>
                <span className="text-sm text-white/60">{feature.text}</span>
              </div>
            ))}
          </div>
        </div>

        <p className="text-white/30 text-xs mt-6">
          Esta funcionalidade está sendo desenvolvida e estará disponível em breve.
        </p>
      </div>
    </div>
  )
}
