'use client'

import { useQuery } from '@tanstack/react-query'
import { Card, CardTitle, CardValue } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { SkeletonCard, SkeletonRow } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

interface Position {
  id: string
  asset: string
  side: 'LONG' | 'SHORT'
  size: number
  entry_price: number
  current_price: number
  pnl_usd: number
  pnl_pct: number
  last_signal_id?: string
}

interface PortfolioSummary {
  total_value: number
  open_pnl: number
  daily_pnl: number
  active_positions: number
  positions: Position[]
}

const MOCK_PORTFOLIO: PortfolioSummary = {
  total_value: 125430.5,
  open_pnl: 3420.8,
  daily_pnl: 1250.3,
  active_positions: 3,
  positions: [
    {
      id: '1',
      asset: 'BTC/USDT',
      side: 'LONG',
      size: 0.5,
      entry_price: 65000,
      current_price: 67450,
      pnl_usd: 1225.0,
      pnl_pct: 3.77,
      last_signal_id: 'sig_001',
    },
    {
      id: '2',
      asset: 'ETH/USDT',
      side: 'LONG',
      size: 4.2,
      entry_price: 3400,
      current_price: 3520,
      pnl_usd: 504.0,
      pnl_pct: 3.53,
      last_signal_id: 'sig_002',
    },
    {
      id: '3',
      asset: 'SOL/USDT',
      side: 'SHORT',
      size: 50,
      entry_price: 155,
      current_price: 148.5,
      pnl_usd: 325.0,
      pnl_pct: 4.19,
      last_signal_id: 'sig_003',
    },
  ],
}

async function fetchPortfolio(): Promise<PortfolioSummary> {
  const res = await fetch('/api/portfolio')
  if (!res.ok) throw new Error('Failed to fetch portfolio')
  return res.json()
}

function formatBRL(n: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(n)
}

export default function PortfolioPage() {
  const { data: portfolio, isLoading, isError } = useQuery<PortfolioSummary>({
    queryKey: ['portfolio'],
    queryFn: fetchPortfolio,
    placeholderData: MOCK_PORTFOLIO,
    refetchInterval: 15_000,
  })

  const display = portfolio ?? MOCK_PORTFOLIO

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white">Portfolio</h1>
        <p className="text-sm text-white/50 mt-0.5">Live position monitor</p>
      </div>

      {isError && (
        <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-sm px-4 py-3 rounded-lg">
          Failed to fetch portfolio from API — showing mock data.
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
              ) : display.positions.length === 0 ? (
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
                display.positions.map((pos) => {
                  const isPnlPositive = pos.pnl_usd >= 0
                  return (
                    <tr key={pos.id} className="border-b border-white/5 hover:bg-white/[0.02] transition-colors">
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
                        {pos.current_price.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                      </td>
                      <td className={cn('px-4 py-3 text-right tabular-nums font-medium', isPnlPositive ? 'text-emerald-400' : 'text-red-400')}>
                        {isPnlPositive ? '+' : ''}{formatBRL(pos.pnl_usd)}
                      </td>
                      <td className={cn('px-4 py-3 text-right tabular-nums font-medium', isPnlPositive ? 'text-emerald-400' : 'text-red-400')}>
                        {isPnlPositive ? '+' : ''}{pos.pnl_pct.toFixed(2)}%
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
