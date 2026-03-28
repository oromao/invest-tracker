'use client'

import { useQuery } from '@tanstack/react-query'
import { format } from 'date-fns'
import { Badge } from '@/components/ui/badge'
import { Card, CardTitle } from '@/components/ui/card'
import { SkeletonCard, SkeletonRow } from '@/components/ui/skeleton'

interface Regime {
  asset: string
  regime: 'trend_bull' | 'trend_bear' | 'range' | 'high_vol' | 'low_vol'
  confidence: number
  timestamp: string
}

const MOCK_REGIMES: Regime[] = [
  { asset: 'BTC', regime: 'trend_bull', confidence: 78, timestamp: new Date().toISOString() },
  { asset: 'ETH', regime: 'trend_bear', confidence: 62, timestamp: new Date().toISOString() },
  { asset: 'BNB', regime: 'range', confidence: 55, timestamp: new Date().toISOString() },
  { asset: 'SOL', regime: 'high_vol', confidence: 70, timestamp: new Date().toISOString() },
]

type RegimeVariant = 'success' | 'danger' | 'info' | 'warning' | 'default'

const REGIME_META: Record<Regime['regime'], { label: string; variant: RegimeVariant; color: string }> = {
  trend_bull: { label: 'Trend Bull', variant: 'success', color: 'text-emerald-400' },
  trend_bear: { label: 'Trend Bear', variant: 'danger', color: 'text-red-400' },
  range: { label: 'Range', variant: 'info', color: 'text-blue-400' },
  high_vol: { label: 'High Vol', variant: 'warning', color: 'text-yellow-400' },
  low_vol: { label: 'Low Vol', variant: 'default', color: 'text-white/50' },
}

async function fetchRegimes(): Promise<Regime[]> {
  const res = await fetch('/api/regimes')
  if (!res.ok) throw new Error('Failed to fetch regimes')
  return res.json()
}

const ASSETS = ['BTC', 'ETH', 'BNB', 'SOL']

export default function RegimesPage() {
  const { data: regimes, isLoading, isError } = useQuery<Regime[]>({
    queryKey: ['regimes'],
    queryFn: fetchRegimes,
    placeholderData: MOCK_REGIMES,
    refetchInterval: 30_000,
  })

  const displayRegimes = regimes ?? MOCK_REGIMES

  // Latest regime per asset
  const latestByAsset = ASSETS.reduce<Record<string, Regime>>((acc, asset) => {
    const found = displayRegimes.find((r) => r.asset === asset)
    if (found) acc[asset] = found
    return acc
  }, {})

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white">Market Regimes</h1>
        <p className="text-sm text-white/50 mt-0.5">Current market state per asset</p>
      </div>

      {isError && (
        <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-sm px-4 py-3 rounded-lg">
          Failed to fetch regimes from API — showing mock data.
        </div>
      )}

      {/* Asset Cards */}
      <div className="grid grid-cols-4 gap-4">
        {isLoading
          ? Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)
          : ASSETS.map((asset) => {
              const regime = latestByAsset[asset]
              if (!regime) return null
              const meta = REGIME_META[regime.regime]
              return (
                <Card key={asset}>
                  <CardTitle>{asset}</CardTitle>
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
                      {format(new Date(regime.timestamp), 'HH:mm:ss')}
                    </p>
                  </div>
                </Card>
              )
            })}
      </div>

      {/* History Table */}
      <div className="bg-[#111111] border border-white/10 rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-white/8">
          <h2 className="text-sm font-semibold text-white">Regime History</h2>
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
                        {format(new Date(regime.timestamp), 'dd/MM/yyyy HH:mm:ss')}
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
