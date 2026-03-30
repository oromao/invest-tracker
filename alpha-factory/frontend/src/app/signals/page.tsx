'use client'

import { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Card, CardTitle, CardValue } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { SkeletonCard, SkeletonRow } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { formatSaoPauloTime } from '@/lib/time'
import { fetchSignals, generateSignals } from '@/utils/api'

interface Signal {
  id: string
  asset: string
  direction: 'LONG' | 'SHORT' | 'NO_TRADE'
  confidence: number   // 0.0–1.0 from API
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
  // value is 0.0–1.0; display as percentage
  const pct = Math.round(normalizePercent(value))
  const color = pct >= 70 ? 'bg-emerald-500' : pct >= 40 ? 'bg-yellow-500' : 'bg-red-500'
  return (
    <div className="flex items-center gap-2">
      <div className="w-16 h-1.5 bg-white/10 rounded-full overflow-hidden">
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
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-white">Alpha Factory</h1>
          <p className="text-sm text-white/50 mt-0.5">Autonomous Signal Engine</p>
        </div>
        <button
          onClick={() => generateMutation.mutate()}
          disabled={generateMutation.isPending}
          className={cn(
            'px-4 py-2 rounded-lg text-sm font-medium transition-all whitespace-nowrap',
            generateMutation.isPending
              ? 'bg-blue-500/30 text-blue-400/60 cursor-not-allowed'
              : 'bg-blue-500 hover:bg-blue-600 text-white'
          )}
        >
          {generateMutation.isPending ? (
            <span className="flex items-center gap-2">
              <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
              </svg>
              Generating…
            </span>
          ) : (
            'Generate Signals'
          )}
        </button>
      </div>

      {isError && (
        <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-sm px-4 py-3 rounded-lg">
          API unavailable — showing empty state.
        </div>
      )}

      {/* Stat Cards — 2 cols on mobile, 4 on md+ */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
        {isLoading ? (
          Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)
        ) : (
          <>
            <Card><CardTitle>Total</CardTitle><CardValue>{total}</CardValue></Card>
            <Card><CardTitle>Long</CardTitle><CardValue className="text-emerald-400">{longs}</CardValue></Card>
            <Card><CardTitle>Short</CardTitle><CardValue className="text-red-400">{shorts}</CardValue></Card>
            <Card><CardTitle>No Trade</CardTitle><CardValue className="text-white/50">{noTrades}</CardValue></Card>
          </>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search asset, regime, direction"
          className="md:col-span-2 bg-[#111] border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-white/25 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
        <select
          value={directionFilter}
          onChange={(e) => setDirectionFilter(e.target.value as typeof directionFilter)}
          className="bg-[#111] border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
        >
          <option value="all">All directions</option>
          <option value="LONG">LONG</option>
          <option value="SHORT">SHORT</option>
          <option value="NO_TRADE">NO TRADE</option>
        </select>
        <select
          value={regimeFilter}
          onChange={(e) => setRegimeFilter(e.target.value)}
          className="bg-[#111] border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
        >
          <option value="all">All regimes</option>
          {availableRegimes.map((regime) => (
            <option key={regime} value={regime}>{regime}</option>
          ))}
        </select>
      </div>

      {/* Signals Table — scrollable on mobile */}
      <div className="bg-[#111111] border border-white/10 rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-white/8">
          <h2 className="text-sm font-semibold text-white">Active Signals</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[640px]">
            <thead>
              <tr className="bg-white/[0.02]">
                {[
                  ['asset', 'Asset'],
                  ['direction', 'Direction'],
                  ['confidence', 'Conf'],
                  ['regime', 'Regime'],
                  ['timestamp', 'Time'],
                ].map(([key, label]) => (
                  <th key={key} className="px-4 py-3 text-left text-xs font-medium text-white/40 uppercase tracking-wider">
                    <button
                      type="button"
                      onClick={() => toggleSort(key as typeof sortKey)}
                      className="inline-flex items-center gap-1 hover:text-white transition-colors"
                    >
                      {label}
                      {sortKey === key && <span>{sortDir === 'asc' ? '↑' : '↓'}</span>}
                    </button>
                  </th>
                ))}
                <th className="px-4 py-3 text-right text-xs font-medium text-white/40 uppercase tracking-wider">Entry</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-white/40 uppercase tracking-wider">TP1</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-white/40 uppercase tracking-wider">SL</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                Array.from({ length: 4 }).map((_, i) => <SkeletonRow key={i} />)
              ) : displaySignals.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center text-white/30">
                    No signals yet — click Generate Signals
                  </td>
                </tr>
              ) : (
                displaySignals.map((signal) => (
                  <tr key={signal.id} className="border-b border-white/5 hover:bg-white/[0.02] transition-colors">
                    <td className="px-4 py-3 font-medium text-white whitespace-nowrap">{signal.asset}</td>
                    <td className="px-4 py-3">{directionBadge(signal.direction)}</td>
                    <td className="px-4 py-3"><ConfidenceBar value={signal.confidenceScore / 100} /></td>
                    <td className="px-4 py-3 text-white/60 text-xs">{signal.regime ?? '—'}</td>
                    <td className="px-4 py-3 text-right text-white/80 tabular-nums">{fmt(signal.entry_price)}</td>
                    <td className="px-4 py-3 text-right text-emerald-400/80 tabular-nums">{fmt(signal.tp1)}</td>
                    <td className="px-4 py-3 text-right text-red-400/80 tabular-nums">{fmt(signal.sl)}</td>
                    <td className="px-4 py-3 text-white/40 text-xs whitespace-nowrap">
                      {formatSaoPauloTime(signal.timestamp)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Explanation Panel for top signal */}
      {displaySignals[0]?.explanation && displaySignals[0].direction !== 'NO_TRADE' && (
        <div className="bg-[#111111] border border-white/10 rounded-xl px-4 py-3">
          <p className="text-xs text-white/40 mb-1 uppercase tracking-wider font-medium">Latest Signal Explanation</p>
          <p className="text-sm text-white/80 leading-relaxed">{displaySignals[0].explanation}</p>
        </div>
      )}
    </div>
  )
}
