'use client'

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { EmptyState, InlineStat, MetricCard, PageHeader, Surface, StatusPill } from '@/components/product-ui'
import { SkeletonCard } from '@/components/ui/skeleton'
import { formatSaoPauloDateTime, formatSaoPauloTime } from '@/lib/time'
import { fetchRegimes } from '@/utils/api'

interface Regime {
  asset: string
  regime: 'trend_bull' | 'trend_bear' | 'range' | 'high_vol' | 'low_vol'
  confidence: number
  timestamp: string
}

type RegimeVariant = 'success' | 'danger' | 'info' | 'warning' | 'default'

const REGIME_META: Record<Regime['regime'], { label: string; variant: RegimeVariant }> = {
  trend_bull: { label: 'Trend Bull', variant: 'success' },
  trend_bear: { label: 'Trend Bear', variant: 'danger' },
  range: { label: 'Range', variant: 'info' },
  high_vol: { label: 'High Vol', variant: 'warning' },
  low_vol: { label: 'Low Vol', variant: 'default' },
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

  const latestRegime = displayRegimes[0]
  const trendCount = displayRegimes.filter((r) => r.regime.includes('trend')).length

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Market Regimes"
        title="Current market state"
        subtitle="Regime snapshots are displayed as readable cards first, with history available below for deeper inspection."
        status={<StatusPill tone={latestRegime ? REGIME_META[latestRegime.regime].variant : 'default'}>{latestRegime ? REGIME_META[latestRegime.regime].label : 'No regime data'}</StatusPill>}
      />

      {isError && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          Failed to fetch regimes from API — showing the current empty or partial state.
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <MetricCard label="Tracked Assets" value={ASSETS.length} tone="info" />
        <MetricCard label="Trend Readings" value={trendCount} tone="success" />
        <MetricCard label="Latest Confidence" value={latestRegime ? `${latestRegime.confidence.toFixed(1)}%` : 'n/a'} tone="warning" />
        <MetricCard label="Freshest Update" value={latestRegime ? formatSaoPauloTime(latestRegime.timestamp) : 'n/a'} />
      </div>

      <Surface title="Filters" description="Search by asset or regime.">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search asset or regime…"
            className="rounded-xl border border-white/10 bg-[#0f0f0f] px-3 py-3 text-sm text-white placeholder:text-white/30 focus:outline-none focus:ring-1 focus:ring-blue-500 md:col-span-2"
          />
          <select
            value={regimeFilter}
            onChange={(e) => setRegimeFilter(e.target.value as typeof regimeFilter)}
            className="rounded-xl border border-white/10 bg-[#0f0f0f] px-3 py-3 text-sm text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            <option value="all">All regimes</option>
            {Object.keys(REGIME_META).map((regime) => (
              <option key={regime} value={regime}>
                {REGIME_META[regime as Regime['regime']].label}
              </option>
            ))}
          </select>
        </div>
      </Surface>

      <Surface title="Current regime snapshots" description="The latest state for each tracked asset.">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {isLoading
            ? Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)
            : ASSETS.map((asset) => {
                const regime = latestByAsset[asset]
                if (!regime) {
                  return (
                    <Card key={asset} className="bg-white/[0.02]">
                      <div className="text-lg font-medium text-white">{asset.split('/')[0]}</div>
                      <p className="mt-3 text-sm text-white/30">No regime data yet.</p>
                    </Card>
                  )
                }
                const meta = REGIME_META[regime.regime]
                const label = asset.split('/')[0]
                return (
                  <Card key={asset} className="bg-white/[0.02]">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-[11px] uppercase tracking-[0.2em] text-white/35">{label}</div>
                        <div className="mt-1 text-base font-medium text-white">{meta.label}</div>
                      </div>
                      <Badge variant={meta.variant}>{meta.label}</Badge>
                    </div>
                    <div className="mt-4 space-y-2">
                      <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
                        <div className="h-full rounded-full bg-blue-500" style={{ width: `${regime.confidence}%` }} />
                      </div>
                      <div className="flex items-center justify-between text-xs text-white/55">
                        <span>Confidence</span>
                        <span>{regime.confidence.toFixed(1)}%</span>
                      </div>
                      <p className="text-[11px] text-white/35">{formatSaoPauloTime(regime.timestamp)}</p>
                    </div>
                  </Card>
                )
              })}
        </div>
      </Surface>

      <Surface title="Regime history" description="Sortable list of raw history for power users.">
        <div className="mb-4 flex flex-wrap gap-2 text-[11px] text-white/35">
          {(['asset', 'regime', 'confidence', 'timestamp'] as const).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => toggleSort(key)}
              className="rounded-full border border-white/10 px-3 py-2 uppercase tracking-[0.18em] transition-colors hover:border-white/20 hover:text-white"
            >
              {key}
              {sortKey === key ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''}
            </button>
          ))}
        </div>

        {isLoading ? (
          <div className="grid gap-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <SkeletonCard key={i} />
            ))}
          </div>
        ) : displayRegimes.length === 0 ? (
          <EmptyState title="No regime data available" description="Run ingestion to create fresh market regime records." />
        ) : (
          <div className="grid gap-3">
            {displayRegimes.map((regime, i) => {
              const meta = REGIME_META[regime.regime]
              return (
                <Card key={`${regime.asset}-${i}`} className="bg-white/[0.02]">
                  <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div className="flex items-center gap-3">
                      <Badge variant={meta.variant}>{meta.label}</Badge>
                      <div className="text-sm font-medium text-white">{regime.asset}</div>
                    </div>
                    <div className="flex flex-wrap gap-2 text-xs text-white/55">
                      <Badge variant="default">{regime.confidence.toFixed(1)}%</Badge>
                      <Badge variant="default">{formatSaoPauloDateTime(regime.timestamp)}</Badge>
                    </div>
                  </div>
                </Card>
              )
            })}
          </div>
        )}
      </Surface>
    </div>
  )
}
