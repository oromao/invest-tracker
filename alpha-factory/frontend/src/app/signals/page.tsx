'use client'

import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Badge } from '@/components/ui/badge'
import { EmptyState, InlineStat, MetricCard, PageHeader, Surface, StatusPill } from '@/components/product-ui'
import { SkeletonCard } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { formatSaoPauloDateTime, formatSaoPauloTime } from '@/lib/time'
import { fetchSignals, generateSignals } from '@/utils/api'

interface Signal {
  id: string
  asset: string
  direction: 'LONG' | 'SHORT' | 'NO_TRADE'
  confidence: number
  entry_price: number | null
  tp1: number | null
  tp2: number | null
  sl: number | null
  regime: string | null
  explanation: string | null
  timestamp: string
}

function directionBadge(direction: Signal['direction']) {
  if (direction === 'LONG') return <Badge variant="success">LONG</Badge>
  if (direction === 'SHORT') return <Badge variant="danger">SHORT</Badge>
  return <Badge variant="default">NO TRADE</Badge>
}

function normalizePercent(value: number): number {
  return Math.abs(value) <= 1 ? value * 100 : value
}

function ConfidenceBar({ value }: { value: number }) {
  const pct = Math.round(normalizePercent(value))
  const color = pct >= 70 ? 'bg-emerald-500' : pct >= 40 ? 'bg-yellow-500' : 'bg-red-500'
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-full max-w-28 overflow-hidden rounded-full bg-white/10">
        <div className={cn('h-full rounded-full', color)} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-white/70">{pct}%</span>
    </div>
  )
}

function fmt(val: number | null | undefined, decimals = 2): string {
  if (val == null || val === 0) return '—'
  return val.toLocaleString('pt-BR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
}

export default function SignalsPage() {
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [directionFilter, setDirectionFilter] = useState<'all' | Signal['direction']>('all')
  const [regimeFilter, setRegimeFilter] = useState<'all' | string>('all')
  const [sortKey, setSortKey] = useState<'timestamp' | 'confidence' | 'asset' | 'direction' | 'regime'>('timestamp')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  const { data: signals, isLoading, isError } = useQuery<Signal[]>({
    queryKey: ['signals'],
    queryFn: fetchSignals,
    refetchInterval: 30_000,
  })

  const generateMutation = useMutation({
    mutationFn: () => generateSignals({ timeframe: '1h' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['signals'] }),
  })

  const displaySignals = useMemo(() => {
    const normalized = (signals ?? []).map((signal) => ({
      ...signal,
      confidenceScore: normalizePercent(signal.confidence),
    }))

    const filtered = normalized.filter((signal) => {
      const q = search.trim().toLowerCase()
      const matchesSearch =
        !q ||
        signal.asset.toLowerCase().includes(q) ||
        (signal.regime ?? '').toLowerCase().includes(q) ||
        signal.direction.toLowerCase().includes(q)
      const matchesDirection = directionFilter === 'all' || signal.direction === directionFilter
      const matchesRegime = regimeFilter === 'all' || signal.regime === regimeFilter
      return matchesSearch && matchesDirection && matchesRegime
    })

    const compare = (a: typeof filtered[number], b: typeof filtered[number]) => {
      const dir = sortDir === 'asc' ? 1 : -1
      switch (sortKey) {
        case 'asset':
          return a.asset.localeCompare(b.asset) * dir
        case 'direction':
          return a.direction.localeCompare(b.direction) * dir
        case 'regime':
          return (a.regime ?? '').localeCompare(b.regime ?? '') * dir
        case 'confidence':
          return ((a.confidenceScore ?? 0) - (b.confidenceScore ?? 0)) * dir
        case 'timestamp':
        default:
          return (new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()) * dir
      }
    }

    return filtered.sort(compare)
  }, [signals, search, directionFilter, regimeFilter, sortKey, sortDir])

  const availableRegimes = useMemo(
    () => Array.from(new Set((signals ?? []).map((signal) => signal.regime).filter(Boolean) as string[])),
    [signals]
  )

  const total = displaySignals.length
  const longs = displaySignals.filter((s) => s.direction === 'LONG').length
  const shorts = displaySignals.filter((s) => s.direction === 'SHORT').length
  const noTrades = displaySignals.filter((s) => s.direction === 'NO_TRADE').length
  const latestSignal = displaySignals[0]
  const sortOptions = [
    ['asset', 'Asset'],
    ['direction', 'Direction'],
    ['confidence', 'Confidence'],
    ['regime', 'Regime'],
    ['timestamp', 'Time'],
  ] as const

  const toggleSort = (key: typeof sortKey) => {
    if (sortKey === key) {
      setSortDir((current) => (current === 'asc' ? 'desc' : 'asc'))
      return
    }
    setSortKey(key)
    setSortDir(key === 'timestamp' ? 'desc' : 'asc')
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Real-Time Signals"
        title="Signal engine"
        subtitle="Readable live signals with confidence, regime context, and exact freshness — optimized for mobile and desktop."
        action={
          <button
            onClick={() => generateMutation.mutate()}
            disabled={generateMutation.isPending}
            className={cn(
              'inline-flex items-center justify-center rounded-full px-4 py-2 text-sm font-medium transition-colors whitespace-nowrap',
              generateMutation.isPending
                ? 'bg-blue-500/30 text-blue-300/60 cursor-not-allowed'
                : 'bg-blue-500 hover:bg-blue-600 text-white'
            )}
          >
            {generateMutation.isPending ? 'Generating…' : 'Generate Signals'}
          </button>
        }
        status={<StatusPill tone={latestSignal?.direction === 'LONG' ? 'success' : latestSignal?.direction === 'SHORT' ? 'danger' : 'default'}>{latestSignal?.direction ?? 'NO SIGNAL'}</StatusPill>}
      />

      {isError && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          API unavailable — showing the current empty or partial state.
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <MetricCard label="Total" value={total} />
        <MetricCard label="Long" value={longs} tone="success" />
        <MetricCard label="Short" value={shorts} tone="danger" />
        <MetricCard label="No Trade" value={noTrades} tone="default" />
      </div>

      <Surface title="Filters" description="Search by asset, direction, or regime.">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search asset, regime, direction…"
            className="rounded-xl border border-white/10 bg-[#0f0f0f] px-3 py-3 text-sm text-white placeholder:text-white/30 focus:outline-none focus:ring-1 focus:ring-blue-500 md:col-span-2"
          />
          <select
            value={directionFilter}
            onChange={(e) => setDirectionFilter(e.target.value as typeof directionFilter)}
            className="rounded-xl border border-white/10 bg-[#0f0f0f] px-3 py-3 text-sm text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            <option value="all">All directions</option>
            <option value="LONG">LONG</option>
            <option value="SHORT">SHORT</option>
            <option value="NO_TRADE">NO TRADE</option>
          </select>
          <select
            value={regimeFilter}
            onChange={(e) => setRegimeFilter(e.target.value)}
            className="rounded-xl border border-white/10 bg-[#0f0f0f] px-3 py-3 text-sm text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            <option value="all">All regimes</option>
            {availableRegimes.map((regime) => (
              <option key={regime} value={regime}>
                {regime}
              </option>
            ))}
          </select>
        </div>
      </Surface>

      <Surface
        title="Active signals"
        description="Signals are presented as compact cards on mobile and read like a decision board instead of a raw table."
      >
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
        ) : displaySignals.length === 0 ? (
          <EmptyState
            title="No signals yet"
            description="Generate signals to populate the board with real, regime-aware output."
          />
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {displaySignals.map((signal) => (
              <article key={signal.id} className="rounded-[1.35rem] border border-white/10 bg-[#0f0f0f] p-4 md:p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-[11px] uppercase tracking-[0.2em] text-white/35">{signal.asset}</div>
                    <div className="mt-1 text-base font-semibold text-white">{signal.regime ?? 'unknown regime'}</div>
                  </div>
                  {directionBadge(signal.direction)}
                </div>

                <div className="mt-4 grid gap-2 md:grid-cols-3">
                  <InlineStat label="Confidence" value={<ConfidenceBar value={signal.confidenceScore / 100} />} tone={signal.confidenceScore >= 70 ? 'success' : signal.confidenceScore >= 40 ? 'warning' : 'danger'} />
                  <InlineStat label="Entry" value={fmt(signal.entry_price)} />
                  <InlineStat label="Time" value={formatSaoPauloTime(signal.timestamp)} />
                </div>

                <div className="mt-4 grid gap-2 md:grid-cols-3">
                  <InlineStat label="TP1" value={fmt(signal.tp1)} tone="success" />
                  <InlineStat label="TP2" value={fmt(signal.tp2)} tone="success" />
                  <InlineStat label="SL" value={fmt(signal.sl)} tone="danger" />
                </div>

                <div className="mt-4 rounded-xl border border-white/8 bg-white/[0.02] p-3 text-sm leading-6 text-white/55">
                  {signal.explanation || 'No signal explanation recorded yet.'}
                </div>

                <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-xs text-white/45">
                  <Badge variant="default">Updated {formatSaoPauloDateTime(signal.timestamp)}</Badge>
                  <Badge variant="default">{signal.regime ?? 'n/a'}</Badge>
                </div>
              </article>
            ))}
          </div>
        )}
      </Surface>
    </div>
  )
}
