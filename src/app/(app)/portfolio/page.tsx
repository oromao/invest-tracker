'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'

interface Position {
  asset: {
    id: string
    ticker: string
    name: string
    type: string
  }
  quantity: number
  averagePrice: number
  currentPrice: number
  totalCost: number
  currentValue: number
  pnl: number
  pnlPercent: number
}

interface PortfolioSummary {
  positions: Position[]
  totalValue: number
  totalCost: number
  totalPnl: number
  totalPnlPercent: number
  byType: Record<string, { value: number; pnl: number }>
}

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
const PCT = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const ASSET_TYPES = [
  { value: 'ALL', label: 'Todos' },
  { value: 'STOCK_BR', label: 'Ação BR' },
  { value: 'STOCK_US', label: 'Ação US' },
  { value: 'FII', label: 'FII' },
  { value: 'CRYPTO', label: 'Crypto' },
  { value: 'OPTION', label: 'Opção' },
]

const ASSET_TYPE_NAMES: Record<string, string> = {
  STOCK_BR: 'Ação BR',
  STOCK_US: 'Ação US',
  FII: 'FII',
  CRYPTO: 'Crypto',
  OPTION: 'Opção',
}

function TableSkeleton() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 6 }).map((_, i) => (
        <Skeleton key={i} className="h-14 w-full rounded-lg" />
      ))}
    </div>
  )
}

export default function PortfolioPage() {
  const [filter, setFilter] = useState('ALL')

  const { data, isLoading, error } = useQuery<PortfolioSummary>({
    queryKey: ['portfolio'],
    queryFn: () => fetch('/api/portfolio').then((r) => r.json()),
  })

  const positions = data?.positions ?? []
  const filtered =
    filter === 'ALL' ? positions : positions.filter((p) => p.asset.type === filter)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Portfólio</h1>
        <p className="text-white/50 text-sm mt-1">Todas as suas posições abertas</p>
      </div>

      {/* Filter tabs */}
      <div className="flex flex-wrap gap-2">
        {ASSET_TYPES.map((t) => (
          <button
            key={t.value}
            onClick={() => setFilter(t.value)}
            className={`px-4 py-1.5 rounded-full text-sm font-medium transition-all ${
              filter === t.value
                ? 'bg-blue-600 text-white'
                : 'bg-white/5 text-white/60 hover:text-white hover:bg-white/10'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <Card className="p-0 overflow-hidden">
        {isLoading ? (
          <div className="p-6">
            <TableSkeleton />
          </div>
        ) : error ? (
          <div className="py-16 text-center text-red-400">
            Erro ao carregar portfólio.
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-16 text-center text-white/40">
            <svg
              className="w-12 h-12 mx-auto mb-4 opacity-30"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
              />
            </svg>
            <p className="text-sm">
              {filter === 'ALL'
                ? 'Nenhuma posição em carteira.'
                : `Nenhuma posição do tipo "${ASSET_TYPE_NAMES[filter] ?? filter}".`}
            </p>
            {filter === 'ALL' && (
              <p className="text-xs mt-2">
                Registre sua primeira operação em{' '}
                <a href="/trades" className="text-blue-400 hover:underline">
                  Operações
                </a>
                .
              </p>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-white/40 border-b border-white/10 bg-white/[0.02]">
                  <th className="text-left px-4 py-3 font-medium">Ativo</th>
                  <th className="text-left px-4 py-3 font-medium">Tipo</th>
                  <th className="text-right px-4 py-3 font-medium">Qtd</th>
                  <th className="text-right px-4 py-3 font-medium">Preço Médio</th>
                  <th className="text-right px-4 py-3 font-medium">Preço Atual</th>
                  <th className="text-right px-4 py-3 font-medium">Valor Total</th>
                  <th className="text-right px-4 py-3 font-medium">P&L (R$)</th>
                  <th className="text-right px-4 py-3 font-medium">P&L (%)</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((pos) => (
                  <tr
                    key={pos.asset.id}
                    className="border-b border-white/5 last:border-0 hover:bg-white/[0.02] transition-colors"
                  >
                    <td className="px-4 py-3">
                      <p className="font-semibold text-white">{pos.asset.ticker}</p>
                      <p className="text-xs text-white/40 truncate max-w-[160px]">
                        {pos.asset.name}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant="default">
                        {ASSET_TYPE_NAMES[pos.asset.type] ?? pos.asset.type}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-right text-white/80">
                      {pos.quantity.toLocaleString('pt-BR', { maximumFractionDigits: 8 })}
                    </td>
                    <td className="px-4 py-3 text-right text-white/80">
                      {BRL.format(pos.averagePrice)}
                    </td>
                    <td className="px-4 py-3 text-right text-white/80">
                      {BRL.format(pos.currentPrice)}
                    </td>
                    <td className="px-4 py-3 text-right font-medium text-white">
                      {BRL.format(pos.currentValue)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span
                        className={`font-medium ${pos.pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}
                      >
                        {pos.pnl >= 0 ? '+' : ''}
                        {BRL.format(pos.pnl)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span
                        className={`font-medium ${pos.pnlPercent >= 0 ? 'text-green-400' : 'text-red-400'}`}
                      >
                        {pos.pnlPercent >= 0 ? '+' : ''}
                        {PCT.format(pos.pnlPercent)}%
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {!isLoading && !error && filtered.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Card>
            <p className="text-xs text-white/50 mb-1">Total Investido (filtro)</p>
            <p className="text-lg font-bold text-white">
              {BRL.format(filtered.reduce((s, p) => s + p.totalCost, 0))}
            </p>
          </Card>
          <Card>
            <p className="text-xs text-white/50 mb-1">Valor Atual (filtro)</p>
            <p className="text-lg font-bold text-white">
              {BRL.format(filtered.reduce((s, p) => s + p.currentValue, 0))}
            </p>
          </Card>
          <Card>
            <p className="text-xs text-white/50 mb-1">P&L (filtro)</p>
            {(() => {
              const pnl = filtered.reduce((s, p) => s + p.pnl, 0)
              return (
                <p className={`text-lg font-bold ${pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {pnl >= 0 ? '+' : ''}{BRL.format(pnl)}
                </p>
              )
            })()}
          </Card>
        </div>
      )}
    </div>
  )
}
