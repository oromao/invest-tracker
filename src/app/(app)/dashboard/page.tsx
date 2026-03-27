'use client'

import { useQuery } from '@tanstack/react-query'
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'

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

const ASSET_TYPE_NAMES: Record<string, string> = {
  STOCK_BR: 'Ação BR',
  STOCK_US: 'Ação US',
  FII: 'FII',
  CRYPTO: 'Crypto',
  OPTION: 'Opção',
}

const PIE_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ef4444']

function SummaryCardSkeleton() {
  return (
    <Card className="space-y-2">
      <Skeleton className="h-4 w-32" />
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-4 w-24" />
    </Card>
  )
}

function TableSkeleton() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 5 }).map((_, i) => (
        <Skeleton key={i} className="h-10 w-full" />
      ))}
    </div>
  )
}

export default function DashboardPage() {
  const { data, isLoading, error } = useQuery<PortfolioSummary>({
    queryKey: ['portfolio'],
    queryFn: () => fetch('/api/portfolio').then((r) => r.json()),
  })

  const pieData = data
    ? Object.entries(data.byType).map(([type, { value }]) => ({
        name: ASSET_TYPE_NAMES[type] ?? type,
        value: +value.toFixed(2),
      }))
    : []

  const top5 = data
    ? [...data.positions]
        .sort((a, b) => b.currentValue - a.currentValue)
        .slice(0, 5)
    : []

  const isPositive = (data?.totalPnl ?? 0) >= 0

  if (error) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-red-400">Erro ao carregar dados do portfólio.</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Dashboard</h1>
        <p className="text-white/50 text-sm mt-1">Resumo do seu portfólio de investimentos</p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {isLoading ? (
          <>
            <SummaryCardSkeleton />
            <SummaryCardSkeleton />
            <SummaryCardSkeleton />
            <SummaryCardSkeleton />
          </>
        ) : (
          <>
            <Card>
              <p className="text-sm text-white/50 mb-1">Total Investido</p>
              <p className="text-2xl font-bold text-white">
                {BRL.format(data?.totalCost ?? 0)}
              </p>
              <p className="text-xs text-white/40 mt-1">Custo médio acumulado</p>
            </Card>

            <Card>
              <p className="text-sm text-white/50 mb-1">Valor Atual</p>
              <p className="text-2xl font-bold text-white">
                {BRL.format(data?.totalValue ?? 0)}
              </p>
              <p className="text-xs text-white/40 mt-1">
                {data?.positions.length ?? 0} ativo(s) em carteira
              </p>
            </Card>

            <Card>
              <p className="text-sm text-white/50 mb-1">P&L Total (R$)</p>
              <p
                className={`text-2xl font-bold ${isPositive ? 'text-green-400' : 'text-red-400'}`}
              >
                {isPositive ? '+' : ''}
                {BRL.format(data?.totalPnl ?? 0)}
              </p>
              <p className="text-xs text-white/40 mt-1">Resultado realizado + não realizado</p>
            </Card>

            <Card>
              <p className="text-sm text-white/50 mb-1">P&L (%)</p>
              <p
                className={`text-2xl font-bold ${isPositive ? 'text-green-400' : 'text-red-400'}`}
              >
                {isPositive ? '+' : ''}
                {PCT.format(data?.totalPnlPercent ?? 0)}%
              </p>
              <p className="text-xs text-white/40 mt-1">Retorno sobre capital investido</p>
            </Card>
          </>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Pie Chart */}
        <Card className="p-6">
          <h2 className="text-base font-semibold text-white mb-4">Alocação por Tipo</h2>
          {isLoading ? (
            <div className="flex items-center justify-center h-56">
              <Skeleton className="w-40 h-40 rounded-full" />
            </div>
          ) : pieData.length === 0 ? (
            <div className="flex items-center justify-center h-56 text-white/40 text-sm">
              Nenhum ativo em carteira
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie
                  data={pieData}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={90}
                  paddingAngle={3}
                  dataKey="value"
                >
                  {pieData.map((_, index) => (
                    <Cell
                      key={`cell-${index}`}
                      fill={PIE_COLORS[index % PIE_COLORS.length]}
                    />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#1a1a1a',
                    border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: '8px',
                    color: '#fff',
                  }}
                  formatter={(value: number) => [BRL.format(value), 'Valor']}
                />
                <Legend
                  formatter={(value) => (
                    <span style={{ color: 'rgba(255,255,255,0.7)', fontSize: '12px' }}>
                      {value}
                    </span>
                  )}
                />
              </PieChart>
            </ResponsiveContainer>
          )}
        </Card>

        {/* Type breakdown */}
        <Card className="p-6">
          <h2 className="text-base font-semibold text-white mb-4">Resumo por Categoria</h2>
          {isLoading ? (
            <TableSkeleton />
          ) : Object.keys(data?.byType ?? {}).length === 0 ? (
            <div className="flex items-center justify-center h-56 text-white/40 text-sm">
              Nenhum dado disponível
            </div>
          ) : (
            <div className="space-y-3">
              {Object.entries(data?.byType ?? {}).map(([type, { value, pnl }], idx) => (
                <div
                  key={type}
                  className="flex items-center justify-between py-2 border-b border-white/5 last:border-0"
                >
                  <div className="flex items-center gap-3">
                    <div
                      className="w-3 h-3 rounded-full flex-shrink-0"
                      style={{ backgroundColor: PIE_COLORS[idx % PIE_COLORS.length] }}
                    />
                    <span className="text-sm text-white/80">
                      {ASSET_TYPE_NAMES[type] ?? type}
                    </span>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-medium text-white">{BRL.format(value)}</p>
                    <p className={`text-xs ${pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {pnl >= 0 ? '+' : ''}{BRL.format(pnl)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* Top 5 Positions */}
      <Card className="p-6">
        <h2 className="text-base font-semibold text-white mb-4">Top 5 Posições</h2>
        {isLoading ? (
          <TableSkeleton />
        ) : top5.length === 0 ? (
          <div className="py-12 text-center text-white/40 text-sm">
            <p>Nenhuma posição em carteira.</p>
            <p className="mt-1">Registre sua primeira operação em <a href="/trades" className="text-blue-400 hover:underline">Operações</a>.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-white/40 border-b border-white/5">
                  <th className="text-left py-2 pr-4 font-medium">Ativo</th>
                  <th className="text-left py-2 pr-4 font-medium">Tipo</th>
                  <th className="text-right py-2 pr-4 font-medium">Qtd</th>
                  <th className="text-right py-2 pr-4 font-medium">Preço Médio</th>
                  <th className="text-right py-2 pr-4 font-medium">Preço Atual</th>
                  <th className="text-right py-2 font-medium">P&L %</th>
                </tr>
              </thead>
              <tbody>
                {top5.map((pos) => (
                  <tr
                    key={pos.asset.id}
                    className="border-b border-white/5 last:border-0 hover:bg-white/[0.02] transition-colors"
                  >
                    <td className="py-3 pr-4">
                      <p className="font-medium text-white">{pos.asset.ticker}</p>
                      <p className="text-xs text-white/40 truncate max-w-[120px]">
                        {pos.asset.name}
                      </p>
                    </td>
                    <td className="py-3 pr-4">
                      <Badge variant="default">
                        {ASSET_TYPE_NAMES[pos.asset.type] ?? pos.asset.type}
                      </Badge>
                    </td>
                    <td className="py-3 pr-4 text-right text-white/80">
                      {pos.quantity.toLocaleString('pt-BR', { maximumFractionDigits: 8 })}
                    </td>
                    <td className="py-3 pr-4 text-right text-white/80">
                      {BRL.format(pos.averagePrice)}
                    </td>
                    <td className="py-3 pr-4 text-right text-white/80">
                      {BRL.format(pos.currentPrice)}
                    </td>
                    <td className="py-3 text-right">
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
    </div>
  )
}
