'use client'

import { useQuery } from '@tanstack/react-query'
import { Card, CardTitle, CardValue } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { SkeletonCard, SkeletonRow } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { fetchPortfolio } from '@/utils/api'

interface Position {
  id?: string
  asset: string
  side?: 'LONG' | 'SHORT'
  direction?: string
  size: number
  entry_price: number
  current_price?: number
  pnl_usd?: number
  pnl?: number
  pnl_pct: number
  last_signal_id?: string
}

interface PortfolioSummary {
  total_value: number
  cash?: number
  invested?: number
  open_pnl?: number
  total_pnl?: number
  daily_pnl: number
  active_positions?: number
  total_pnl_pct?: number
  daily_pnl_pct?: number
  timestamp?: string
  positions: Position[]
}

function normalizePosition(p: Position): Position & { pnl_usd: number; side: 'LONG' | 'SHORT' } {
  return {
    ...p,
    pnl_usd: p.pnl_usd ?? p.pnl ?? 0,
    side: (p.side ?? (p.direction as 'LONG' | 'SHORT') ?? 'LONG'),
    current_price: p.current_price ?? p.entry_price,
  }
}

function normalizePortfolio(p: PortfolioSummary): PortfolioSummary & { open_pnl: number; active_positions: number } {
  return {
    ...p,
    open_pnl: p.open_pnl ?? p.total_pnl ?? 0,
    active_positions: p.active_positions ?? p.positions.length,
  }
}

function formatBRL(n: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(n)
}

function normalizePercent(value: number): number {
  return Math.abs(value) <= 1 ? value * 100 : value
}

export default function PortfolioPage() {
  const { data: rawPortfolio, isLoading, isError } = useQuery<PortfolioSummary>({
    queryKey: ['portfolio'],
    queryFn: fetchPortfolio,
    refetchInterval: 15_000,
  })

  const display = normalizePortfolio(
    rawPortfolio ?? {
      total_value: 0,
      cash: 0,
      invested: 0,
      open_pnl: 0,
      daily_pnl: 0,
      daily_pnl_pct: 0,
      total_pnl: 0,
      total_pnl_pct: 0,
      active_positions: 0,
      positions: [],
      timestamp: new Date().toISOString(),
    }
  )
  const positions = display.positions.map(normalizePosition)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white">Portfolio</h1>
        <p className="text-sm text-white/50 mt-0.5">Live position monitor</p>
      </div>

      {isError && (
        <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-sm px-4 py-3 rounded-lg">
          Failed to fetch portfolio from API — showing empty state.
        </div>
      )}

      {/* Summary Cards */}
      <div className="grid grid-cols-4 gap-4">
        {isLoading ? (
          Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)
        ) : (
          <>
            <Card>
              <CardTitle>Total Value</CardTitle>
              <CardValue className="text-base font-bold text-white">
                {formatBRL(display.total_value)}
              </CardValue>
            </Card>
            <Card>
              <CardTitle>Open PnL</CardTitle>
              <CardValue
                className={cn(
                  'text-base font-bold',
                  display.open_pnl >= 0 ? 'text-emerald-400' : 'text-red-400'
                )}
              >
                {display.open_pnl >= 0 ? '+' : ''}
                {formatBRL(display.open_pnl)}
              </CardValue>
            </Card>
            <Card>
              <CardTitle>Daily PnL</CardTitle>
              <CardValue
                className={cn(
                  'text-base font-bold',
                  display.daily_pnl >= 0 ? 'text-emerald-400' : 'text-red-400'
                )}
              >
                {display.daily_pnl >= 0 ? '+' : ''}
                {formatBRL(display.daily_pnl)}
              </CardValue>
            </Card>
            <Card>
              <CardTitle>Active Positions</CardTitle>
              <CardValue>{display.active_positions}</CardValue>
            </Card>
          </>
        )}
      </div>

      {/* Positions Table */}
      <div className="bg-[#111111] border border-white/10 rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-white/8">
          <h2 className="text-sm font-semibold text-white">Open Positions</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-white/[0.02]">
                <th className="px-4 py-3 text-left text-xs font-medium text-white/40 uppercase tracking-wider">Asset</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-white/40 uppercase tracking-wider">Side</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-white/40 uppercase tracking-wider">Size</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-white/40 uppercase tracking-wider">Entry</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-white/40 uppercase tracking-wider">Current</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-white/40 uppercase tracking-wider">PnL (R$)</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-white/40 uppercase tracking-wider">PnL (%)</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-white/40 uppercase tracking-wider">Signal</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                Array.from({ length: 3 }).map((_, i) => <SkeletonRow key={i} />)
              ) : positions.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-16 text-center">
                    <div className="flex flex-col items-center gap-3 text-white/30">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-10 h-10 text-white/15">
                        <rect x="2" y="7" width="20" height="14" rx="2" />
                        <path strokeLinecap="round" d="M16 7V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v2" />
                        <path strokeLinecap="round" d="M12 12v4M10 14h4" />
                      </svg>
                      <div>
                        <p className="font-medium text-white/40">No open positions</p>
                        <p className="text-xs mt-0.5">Positions will appear here when signals are executed</p>
                      </div>
                    </div>
                  </td>
                </tr>
              ) : (
                positions.map((pos, idx) => {
                  const isPnlPositive = pos.pnl_usd >= 0
                  return (
                    <tr key={pos.id ?? idx} className="border-b border-white/5 hover:bg-white/[0.02] transition-colors">
                      <td className="px-4 py-3 font-medium text-white">{pos.asset}</td>
                      <td className="px-4 py-3">
                        {pos.side === 'LONG' ? (
                          <Badge variant="success">LONG</Badge>
                        ) : (
                          <Badge variant="danger">SHORT</Badge>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right text-white/70 tabular-nums">{pos.size}</td>
                      <td className="px-4 py-3 text-right text-white/60 tabular-nums">
                        {pos.entry_price.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                      </td>
                      <td className="px-4 py-3 text-right text-white tabular-nums">
                        {pos.current_price!.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                      </td>
                      <td className={cn('px-4 py-3 text-right tabular-nums font-medium', isPnlPositive ? 'text-emerald-400' : 'text-red-400')}>
                        {isPnlPositive ? '+' : ''}{formatBRL(pos.pnl_usd)}
                      </td>
                      <td className={cn('px-4 py-3 text-right tabular-nums font-medium', isPnlPositive ? 'text-emerald-400' : 'text-red-400')}>
                        {isPnlPositive ? '+' : ''}{normalizePercent(pos.pnl_pct).toFixed(2)}%
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-white/30">
                        {pos.last_signal_id ?? '—'}
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
