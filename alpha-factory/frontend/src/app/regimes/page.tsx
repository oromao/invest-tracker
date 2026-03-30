'use client'

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Badge } from '@/components/ui/badge'
import { Card, CardTitle } from '@/components/ui/card'
import { SkeletonCard, SkeletonRow } from '@/components/ui/skeleton'
import { formatSaoPauloDateTime, formatSaoPauloTime } from '@/lib/time'
import { fetchRegimes } from '@/utils/api'

interface Regime {
  asset: string
  regime: 'trend_bull' | 'trend_bear' | 'range' | 'high_vol' | 'low_vol'
  confidence: number
  timestamp: string
}

type RegimeVariant = 'success' | 'danger' | 'info' | 'warning' | 'default'

const REGIME_META: Record<Regime['regime'], { label: string; variant: RegimeVariant; color: string }> = {
  trend_bull: { label: 'Trend Bull', variant: 'success', color: 'text-emerald-400' },
  trend_bear: { label: 'Trend Bear', variant: 'danger', color: 'text-red-400' },
  range: { label: 'Range', variant: 'info', color: 'text-blue-400' },
  high_vol: { label: 'High Vol', variant: 'warning', color: 'text-yellow-400' },
  low_vol: { label: 'Low Vol', variant: 'default', color: 'text-white/50' },
}

const ASSETS = ['BTC/USDT', 'ETH/USDT', 'BNB/USDT', 'SOL/USDT']

function normalizeConfidence(value: number): number {
  return Math.abs(value) <= 1 ? value * 100 : value
}

export default function RegimesPage() {
  const [search, setSearch] = useState('')
  const [regimeFilter, setRegimeFilter] = useState<'all' | Regime['regime']>('all')
  const [sortKey, setSortKey] = useState<'timestamp' | 'confidence' | 'asset' | 'regime'>('timestamp')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  const { data: regimes, isLoading, isError } = useQuery<Regime[]>({
    queryKey: ['regimes'],
    queryFn: fetchRegimes,
    refetchInterval: 30_000,
  })

  const displayRegimes = useMemo(() => {
    const normalized = (regimes ?? []).map((regime) => ({
      ...regime,
      confidence: normalizeConfidence(regime.confidence),
    }))
    const filtered = normalized.filter((regime) => {
      const q = search.trim().toLowerCase()
      const matchesSearch = !q || regime.asset.toLowerCase().includes(q) || regime.regime.toLowerCase().includes(q)
      const matchesRegime = regimeFilter === 'all' || regime.regime === regimeFilter
      return matchesSearch && matchesRegime
    })
    const dir = sortDir === 'asc' ? 1 : -1
    return filtered.sort((a, b) => {
      switch (sortKey) {
        case 'asset':
          return a.asset.localeCompare(b.asset) * dir
        case 'regime':
          return a.regime.localeCompare(b.regime) * dir
        case 'confidence':
          return (a.confidence - b.confidence) * dir
        case 'timestamp':
        default:
          return (new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()) * dir
      }
    })
  }, [regimes, search, regimeFilter, sortKey, sortDir])

  // Latest regime per asset
  const latestByAsset = ASSETS.reduce<Record<string, Regime>>((acc, asset) => {
    const found = displayRegimes.find((r) => r.asset === asset)
    if (found) acc[asset] = found
    return acc
  }, {})

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
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold text-white">Market Regimes</h1>
        <p className="text-sm text-white/50 mt-0.5">Current market state per asset</p>
      </div>

      {isError && (
        <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-sm px-4 py-3 rounded-lg">
          Failed to fetch regimes from API — showing empty state.
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search asset or regime"
          className="md:col-span-2 bg-[#111] border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-white/25 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
        <select
          value={regimeFilter}
          onChange={(e) => setRegimeFilter(e.target.value as typeof regimeFilter)}
          className="bg-[#111] border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
        >
          <option value="all">All regimes</option>
          {Object.keys(REGIME_META).map((regime) => (
            <option key={regime} value={regime}>{REGIME_META[regime as Regime['regime']].label}</option>
          ))}
        </select>
      </div>

      {/* Asset Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
        {isLoading
          ? Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)
          : ASSETS.map((asset) => {
              const regime = latestByAsset[asset]
              if (!regime) {
                return (
                  <Card key={asset}>
                    <CardTitle>{asset.split('/')[0]}</CardTitle>
                    <p className="mt-3 text-sm text-white/30">No regime data yet.</p>
                  </Card>
                )
              }
              const meta = REGIME_META[regime.regime]
              const label = asset.split('/')[0]
              return (
                <Card key={asset}>
                  <CardTitle>{label}</CardTitle>
                  <div className="mt-3 space-y-2">
                    <Badge variant={meta.variant}>{meta.label}</Badge>
                    <div className="flex items-center gap-2 mt-2">
                      <div className="w-full h-1.5 bg-white/10 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full ${
                            meta.variant === 'success' ? 'bg-emerald-500' :
                            meta.variant === 'danger' ? 'bg-red-500' :
                            meta.variant === 'info' ? 'bg-blue-500' :
                            meta.variant === 'warning' ? 'bg-yellow-500' :
                            'bg-white/30'
                          }`}
                          style={{ width: `${regime.confidence}%` }}
                        />
                      </div>
                      <span className="text-xs text-white/60 whitespace-nowrap">{regime.confidence}%</span>
                    </div>
                    <p className="text-[11px] text-white/30">
                      {formatSaoPauloTime(regime.timestamp)}
                    </p>
                  </div>
                </Card>
              )
            })}
      </div>

      {/* History Table */}
      <div className="bg-[#111111] border border-white/10 rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-white/8">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-white">Regime History</h2>
            <div className="flex items-center gap-1 text-[11px] text-white/35">
              {(['asset', 'regime', 'confidence', 'timestamp'] as const).map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => toggleSort(key)}
                  className="rounded-md border border-white/10 px-2 py-1 hover:text-white hover:border-white/20 transition-colors"
                >
                  {key}
                  {sortKey === key ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-white/[0.02]">
                <th className="px-4 py-3 text-left text-xs font-medium text-white/40 uppercase tracking-wider">Asset</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-white/40 uppercase tracking-wider">Regime</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-white/40 uppercase tracking-wider">Confidence</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-white/40 uppercase tracking-wider">Timestamp</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                Array.from({ length: 4 }).map((_, i) => <SkeletonRow key={i} />)
              ) : displayRegimes.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-12 text-center text-white/30">
                    <div className="flex flex-col items-center gap-2">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-8 h-8 text-white/20">
                        <circle cx="12" cy="12" r="10" />
                        <path strokeLinecap="round" d="M12 8v4l3 3" />
                      </svg>
                      <span>No regime data available</span>
                    </div>
                  </td>
                </tr>
              ) : (
                displayRegimes.map((regime, i) => {
                  const meta = REGIME_META[regime.regime]
                  return (
                    <tr key={i} className="border-b border-white/5 hover:bg-white/[0.02] transition-colors">
                      <td className="px-4 py-3 font-medium text-white">{regime.asset}</td>
                      <td className="px-4 py-3"><Badge variant={meta.variant}>{meta.label}</Badge></td>
                      <td className="px-4 py-3 text-white/70">{regime.confidence}%</td>
                      <td className="px-4 py-3 text-white/40 text-xs">
                        {formatSaoPauloDateTime(regime.timestamp)}
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
