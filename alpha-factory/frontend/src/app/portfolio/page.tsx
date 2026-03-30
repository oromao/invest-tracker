'use client'

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { EmptyState, InlineStat, MetricCard, PageHeader, Surface, StatusPill } from '@/components/product-ui'
import { SkeletonCard } from '@/components/ui/skeleton'
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

export default function PortfolioPage() {
  const [search, setSearch] = useState('')
  const [sideFilter, setSideFilter] = useState<'all' | 'LONG' | 'SHORT'>('all')
  const [sortKey, setSortKey] = useState<'asset' | 'side' | 'size' | 'entry_price' | 'current_price' | 'pnl_usd' | 'pnl_pct'>('pnl_usd')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

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

  const positions = useMemo(() => {
    const normalized = display.positions.map(normalizePosition)
    const filtered = normalized.filter((pos) => {
      const q = search.trim().toLowerCase()
      const matchesSearch = !q || pos.asset.toLowerCase().includes(q) || (pos.last_signal_id ?? '').toLowerCase().includes(q)
      const matchesSide = sideFilter === 'all' || pos.side === sideFilter
      return matchesSearch && matchesSide
    })
    const dir = sortDir === 'asc' ? 1 : -1
    return filtered.sort((a, b) => {
      switch (sortKey) {
        case 'asset':
          return a.asset.localeCompare(b.asset) * dir
        case 'side':
          return a.side.localeCompare(b.side) * dir
        case 'size':
          return (a.size - b.size) * dir
        case 'entry_price':
          return (a.entry_price - b.entry_price) * dir
        case 'current_price':
          return ((a.current_price ?? 0) - (b.current_price ?? 0)) * dir
        case 'pnl_pct':
          return (a.pnl_pct - b.pnl_pct) * dir
        case 'pnl_usd':
        default:
          return (a.pnl_usd - b.pnl_usd) * dir
      }
    })
  }, [display.positions, search, sideFilter, sortKey, sortDir])
  const longCount = positions.filter((position) => position.side === 'LONG').length
  const shortCount = positions.filter((position) => position.side === 'SHORT').length
  const largestPosition = positions.reduce<ReturnType<typeof normalizePosition> | null>((acc, position) => {
    if (!acc) return position
    return position.entry_price * position.size > acc.entry_price * acc.size ? position : acc
  }, null)
  const sortOptions = [
    ['asset', 'Asset'],
    ['side', 'Side'],
    ['size', 'Size'],
    ['entry_price', 'Entry'],
    ['current_price', 'Current'],
    ['pnl_usd', 'PnL'],
    ['pnl_pct', 'PnL %'],
  ] as const

  const toggleSort = (key: typeof sortKey) => {
    if (sortKey === key) {
      setSortDir((current) => (current === 'asc' ? 'desc' : 'asc'))
      return
    }
    setSortKey(key)
    setSortDir(key === 'pnl_usd' ? 'desc' : 'asc')
  }

  const bestPosition = positions[0]

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Portfolio"
        title="Position monitor"
        subtitle="A compact view of exposure, PnL, and live position detail. Heavy numeric tables are reduced to readable cards on mobile."
        status={<StatusPill tone={display.open_pnl >= 0 ? 'success' : 'danger'}>{display.open_pnl >= 0 ? 'Positive PnL' : 'Down on the day'}</StatusPill>}
      />

      {isError && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          Failed to fetch portfolio from API — showing the current empty or partial state.
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <MetricCard label="Total Value" value={formatBRL(display.total_value)} />
        <MetricCard label="Open PnL" value={`${display.open_pnl >= 0 ? '+' : ''}${formatBRL(display.open_pnl)}`} tone={display.open_pnl >= 0 ? 'success' : 'danger'} />
        <MetricCard label="Daily PnL" value={`${display.daily_pnl >= 0 ? '+' : ''}${formatBRL(display.daily_pnl)}`} tone={display.daily_pnl >= 0 ? 'success' : 'danger'} />
        <MetricCard label="Active Positions" value={display.active_positions} tone="info" />
      </div>

      <Surface title="Exposure summary" description="Allocation by strategy is not stored here, so the dashboard uses open notional as the real proxy.">
        <div className="grid gap-3 md:grid-cols-4">
          <InlineStat label="Long / Short" value={`${longCount}/${shortCount}`} tone="info" />
          <InlineStat label="Invested" value={formatBRL(display.invested ?? 0)} />
          <InlineStat label="Open Notional" value={formatBRL(positions.reduce((sum, position) => sum + position.entry_price * position.size, 0))} />
          <InlineStat label="Largest Asset" value={largestPosition?.asset ?? 'n/a'} tone={largestPosition ? 'warning' : 'default'} />
        </div>
      </Surface>

      <Surface title="Filters" description="Search by asset or linked signal.">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search asset or signal…"
            className="rounded-xl border border-white/10 bg-[#0f0f0f] px-3 py-3 text-sm text-white placeholder:text-white/30 focus:outline-none focus:ring-1 focus:ring-blue-500 md:col-span-2"
          />
          <select
            value={sideFilter}
            onChange={(e) => setSideFilter(e.target.value as typeof sideFilter)}
            className="rounded-xl border border-white/10 bg-[#0f0f0f] px-3 py-3 text-sm text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            <option value="all">All sides</option>
            <option value="LONG">LONG</option>
            <option value="SHORT">SHORT</option>
          </select>
        </div>
      </Surface>

      <Surface title="Open positions" description="A clean card stack on mobile, sortable controls for power users.">
        <div className="mb-4 flex flex-wrap gap-2 text-[11px] text-white/35">
          {sortOptions.map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => toggleSort(key)}
              className="rounded-full border border-white/10 px-3 py-2 uppercase tracking-[0.18em] transition-colors hover:border-white/20 hover:text-white"
            >
              {label}
              {sortKey === key ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''}
            </button>
          ))}
        </div>

        {isLoading ? (
          <div className="grid gap-3 lg:grid-cols-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <SkeletonCard key={i} />
            ))}
          </div>
        ) : positions.length === 0 ? (
          <EmptyState title="No open positions" description="The portfolio is currently flat." />
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {positions.map((pos) => (
              <Card key={pos.asset} className="bg-white/[0.02]">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-[11px] uppercase tracking-[0.2em] text-white/35">{pos.asset}</div>
                    <div className="mt-1 text-base font-medium text-white">{pos.side}</div>
                  </div>
                  <Badge variant={pos.side === 'LONG' ? 'success' : 'danger'}>{pos.side}</Badge>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-4">
                  <InlineStat label="Size" value={pos.size.toLocaleString('pt-BR')} />
                  <InlineStat label="Entry" value={pos.entry_price.toLocaleString('pt-BR')} />
                  <InlineStat label="Current" value={pos.current_price?.toLocaleString('pt-BR') ?? '—'} />
                  <InlineStat label="PnL %" value={`${pos.pnl_pct.toFixed(2)}%`} tone={pos.pnl_pct >= 0 ? 'success' : 'danger'} />
                </div>
                <div className="mt-4 rounded-xl border border-white/8 bg-white/[0.02] p-3 text-sm text-white/55">
                  PnL: {pos.pnl_usd >= 0 ? '+' : ''}{formatBRL(pos.pnl_usd)}
                </div>
                <div className="mt-4 grid gap-2 text-xs text-white/40 sm:grid-cols-2">
                  <div>Last signal: {pos.last_signal_id ?? 'n/a'}</div>
                  <div>Notional: {formatBRL(pos.entry_price * pos.size)}</div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </Surface>

      <Surface title="Largest current exposure" description="The highest-impact position currently open.">
        {bestPosition ? (
          <div className="grid gap-3 md:grid-cols-4">
            <InlineStat label="Asset" value={bestPosition.asset} />
            <InlineStat label="Side" value={bestPosition.side} tone={bestPosition.side === 'LONG' ? 'success' : 'danger'} />
            <InlineStat label="PnL" value={`${bestPosition.pnl_usd >= 0 ? '+' : ''}${formatBRL(bestPosition.pnl_usd)}`} tone={bestPosition.pnl_usd >= 0 ? 'success' : 'danger'} />
            <InlineStat label="Signal" value={bestPosition.last_signal_id ?? 'n/a'} />
          </div>
        ) : (
          <EmptyState title="No exposure right now" description="The portfolio is flat, so there is no dominant position to highlight." />
        )}
      </Surface>
    </div>
  )
}
