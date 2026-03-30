'use client'

import { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Badge } from '@/components/ui/badge'
import { Card, CardTitle, CardValue } from '@/components/ui/card'
import { SkeletonCard, SkeletonRow } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { formatSaoPauloDateTime } from '@/lib/time'
import {
  deprecateStrategy,
  fetchStrategies,
  fetchStrategyLeaderboard,
  fetchPromotionStatus,
  promoteStrategy,
  runResearchCycle,
} from '@/utils/api'

interface Strategy {
  id: string
  strategy_id: string
  name: string
  version: number
  status: 'draft' | 'candidate' | 'active' | 'deprecated'
  params: Record<string, unknown>
  created_at: string
  updated_at: string
  lifecycle_state?: string | null
  latest_score?: number | null
  latest_reason?: string | null
  latest_metrics?: Record<string, number | string | null> | null
  promotion_diagnostics?: {
    baseline_current_active_score?: number
    baseline_proven_score?: number
    current_active_score?: number
    competition_mode?: string
    blockers?: string[]
    closest_to_promotion?: boolean
    weak_to_deprecate?: boolean
    gates?: Record<string, boolean>
    target?: {
      strategy_id?: string
      score?: number
      sharpe?: number
      profit_factor?: number
      max_drawdown?: number
      total_trades?: number
      oos_sharpe?: number
      oos_profit_factor?: number
      reason?: string
      lifecycle_state?: string
    } | null
  }
}

type StatusVariant = 'default' | 'warning' | 'success' | 'danger'

const STATUS_META: Record<Strategy['status'], { variant: StatusVariant; label: string }> = {
  draft: { variant: 'default', label: 'Draft' },
  candidate: { variant: 'warning', label: 'Candidate' },
  active: { variant: 'success', label: 'Active' },
  deprecated: { variant: 'danger', label: 'Deprecated' },
}

export default function ResearchPage() {
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | Strategy['status']>('all')
  const [sortKey, setSortKey] = useState<'updated_at' | 'name' | 'status' | 'score' | 'trades'>('updated_at')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  const { data: strategies, isLoading, isError } = useQuery<Strategy[]>({
    queryKey: ['strategies'],
    queryFn: fetchStrategies,
  })

  const { data: leaderboard } = useQuery<Strategy[]>({
    queryKey: ['strategy-leaderboard'],
    queryFn: fetchStrategyLeaderboard,
    staleTime: 15_000,
  })

  const { data: promotionStatus } = useQuery({
    queryKey: ['promotion-status'],
    queryFn: () => fetchPromotionStatus(),
    staleTime: 10_000,
  })

  const researchMutation = useMutation({
    mutationFn: () => runResearchCycle({ asset: 'BTC/USDT', timeframe: '1h' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['strategies'] }),
  })

  const promoteMutation = useMutation({
    mutationFn: promoteStrategy,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['strategies'] }),
  })

  const deprecateMutation = useMutation({
    mutationFn: deprecateStrategy,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['strategies'] }),
  })

  const displayStrategies = useMemo(() => {
    const normalized = (strategies ?? []).map((strategy) => ({
      ...strategy,
      params: strategy.params ?? {},
      score: strategy.latest_score ?? 0,
      trades: Number(strategy.latest_metrics?.total_trades ?? 0),
    }))
    const filtered = normalized.filter((strategy) => {
      const q = search.trim().toLowerCase()
      const matchesSearch =
        !q ||
        strategy.strategy_id.toLowerCase().includes(q) ||
        strategy.name.toLowerCase().includes(q) ||
        (strategy.latest_reason ?? '').toLowerCase().includes(q)
      const matchesStatus = statusFilter === 'all' || strategy.status === statusFilter
      return matchesSearch && matchesStatus
    })
    const dir = sortDir === 'asc' ? 1 : -1
    return filtered.sort((a, b) => {
      switch (sortKey) {
        case 'name':
          return a.name.localeCompare(b.name) * dir
        case 'status':
          return a.status.localeCompare(b.status) * dir
        case 'score':
          return (a.score - b.score) * dir
        case 'trades':
          return (a.trades - b.trades) * dir
        case 'updated_at':
        default:
          return (new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime()) * dir
      }
    })
  }, [strategies, search, statusFilter, sortKey, sortDir])

  const toggleSort = (key: typeof sortKey) => {
    if (sortKey === key) {
      setSortDir((current) => (current === 'asc' ? 'desc' : 'asc'))
      return
    }
    setSortKey(key)
    setSortDir(key === 'updated_at' ? 'desc' : 'asc')
  }

  const active = displayStrategies.filter((s) => s.status === 'active').length
  const candidates = displayStrategies.filter((s) => s.status === 'candidate').length
  const drafts = displayStrategies.filter((s) => s.status === 'draft').length
  const deprecated = displayStrategies.filter((s) => s.status === 'deprecated').length
  const total = displayStrategies.length
  const bestStrategies = (leaderboard ?? []).slice(0, 5)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Research Lab</h1>
          <p className="text-sm text-white/50 mt-0.5">Autonomous Strategy Discovery</p>
        </div>
        <button
          onClick={() => researchMutation.mutate()}
          disabled={researchMutation.isPending}
          className={cn(
            'px-4 py-2 rounded-lg text-sm font-medium transition-all',
            researchMutation.isPending
              ? 'bg-blue-500/30 text-blue-400/60 cursor-not-allowed'
              : 'bg-blue-500 hover:bg-blue-600 text-white'
          )}
        >
          {researchMutation.isPending ? (
            <span className="flex items-center gap-2">
              <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
              </svg>
              Running…
            </span>
          ) : (
            'Run Research Cycle'
          )}
        </button>
      </div>

      {isError && (
        <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-sm px-4 py-3 rounded-lg">
          Failed to fetch strategies from API — showing empty state.
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search strategy, reason or ID"
          className="md:col-span-2 bg-[#111] border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-white/25 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
          className="bg-[#111] border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
        >
          <option value="all">All statuses</option>
          <option value="draft">Draft</option>
          <option value="candidate">Candidate</option>
          <option value="active">Active</option>
          <option value="deprecated">Deprecated</option>
        </select>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 md:gap-4">
        {isLoading ? (
          Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)
        ) : (
          <>
            <Card>
              <CardTitle>Active</CardTitle>
              <CardValue className="text-emerald-400">{active}</CardValue>
            </Card>
            <Card>
              <CardTitle>Candidates</CardTitle>
              <CardValue className="text-yellow-400">{candidates}</CardValue>
            </Card>
            <Card>
              <CardTitle>Total Strategies</CardTitle>
              <CardValue>{total}</CardValue>
            </Card>
            <Card>
              <CardTitle>Deprecated</CardTitle>
              <CardValue className="text-red-400">{deprecated}</CardValue>
            </Card>
          </>
        )}
      </div>

      <div className="bg-[#111111] border border-white/10 rounded-xl p-4">
        <div className="flex items-center justify-between gap-3 mb-3">
          <div>
            <h2 className="text-sm font-semibold text-white">Promotion Diagnostics</h2>
            <p className="text-xs text-white/40 mt-0.5">Why the current leader is or is not being auto-promoted</p>
          </div>
          <Badge variant={promotionStatus?.closest_to_promotion ? 'success' : 'warning'}>
            {promotionStatus?.closest_to_promotion ? 'Eligible' : 'Blocked'}
          </Badge>
        </div>
        {!promotionStatus ? (
          <div className="text-sm text-white/30">Loading promotion state…</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
            <div className="rounded-lg border border-white/10 bg-white/[0.02] p-3">
              <div className="text-white/35 text-xs uppercase">Active Baseline</div>
              <div className="text-white font-semibold">{Number(promotionStatus.baseline_current_active_score ?? promotionStatus.baseline_proven_score ?? 0).toFixed(3)}</div>
              <div className="text-white/35 text-xs mt-1">{promotionStatus.competition_mode || 'current_active_baseline'}</div>
            </div>
            <div className="rounded-lg border border-white/10 bg-white/[0.02] p-3">
              <div className="text-white/35 text-xs uppercase">Top Candidate</div>
              <div className="text-white font-semibold">{promotionStatus.target?.strategy_id ?? 'n/a'}</div>
              <div className="text-white/35 text-xs mt-1">
                score {Number(promotionStatus.target?.score ?? 0).toFixed(3)} · trades {Number(promotionStatus.target?.total_trades ?? 0)}
              </div>
            </div>
            <div className="rounded-lg border border-white/10 bg-white/[0.02] p-3">
              <div className="text-white/35 text-xs uppercase">Blockers</div>
              <div className="text-white font-semibold">{promotionStatus.blockers?.length ?? 0}</div>
              <div className="text-white/35 text-xs mt-1">
                {(promotionStatus.blockers?.length ? promotionStatus.blockers : ['No blockers']).join(' • ')}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Best Strategies */}
      <div className="bg-[#111111] border border-white/10 rounded-xl p-4">
        <div className="flex items-center justify-between gap-3 mb-4">
          <div>
            <h2 className="text-sm font-semibold text-white">Best Strategies</h2>
            <p className="text-xs text-white/40 mt-0.5">Ranked by robust backtest score and lifecycle progress</p>
          </div>
        </div>
        {bestStrategies.length === 0 ? (
          <div className="text-sm text-white/30">No ranked strategies yet. Run the research cycle.</div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {bestStrategies.map((strategy, index) => (
              <div key={strategy.strategy_id} className="rounded-lg border border-white/10 bg-white/[0.02] p-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="text-xs text-white/40">#{index + 1}</div>
                    <div className="font-medium text-white">{strategy.name}</div>
                    <div className="text-[11px] text-white/40 font-mono">{strategy.strategy_id}</div>
                  </div>
                  <Badge variant={strategy.lifecycle_state === 'paper' || strategy.status === 'active' ? 'success' : strategy.status === 'candidate' ? 'warning' : 'default'}>
                    {strategy.lifecycle_state || strategy.status}
                  </Badge>
                </div>
                <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                  <div className="rounded-md bg-black/20 p-2">
                    <div className="text-white/30">Score</div>
                    <div className="text-white font-semibold">{(strategy.latest_score ?? 0).toFixed(3)}</div>
                  </div>
                  <div className="rounded-md bg-black/20 p-2">
                    <div className="text-white/30">Sharpe</div>
                    <div className="text-white font-semibold">{Number(strategy.latest_metrics?.sharpe ?? 0).toFixed(2)}</div>
                  </div>
                  <div className="rounded-md bg-black/20 p-2">
                    <div className="text-white/30">PF</div>
                    <div className="text-white font-semibold">{Number(strategy.latest_metrics?.profit_factor ?? 0).toFixed(2)}</div>
                  </div>
                  <div className="rounded-md bg-black/20 p-2">
                    <div className="text-white/30">Trades</div>
                    <div className="text-white font-semibold">{Number(strategy.latest_metrics?.total_trades ?? 0)}</div>
                  </div>
                </div>
                <div className="mt-3 text-xs text-white/45">
                  {strategy.latest_reason || 'No evaluation note recorded'}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Pipeline Flow */}
      <div className="bg-[#111111] border border-white/10 rounded-xl p-4">
        <h2 className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-4">Strategy Pipeline</h2>
        <div className="flex flex-col md:flex-row md:items-center gap-3 md:gap-2">
          {[
            { label: 'Draft', count: drafts, color: 'bg-white/10 text-white/50 border-white/10' },
            { label: 'Candidate', count: candidates, color: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/20' },
            { label: 'Active', count: active, color: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20' },
            { label: 'Deprecated', count: deprecated, color: 'bg-red-500/15 text-red-400 border-red-500/20' },
          ].map((stage, i) => (
            <div key={stage.label} className="flex flex-col md:flex-row items-stretch md:items-center gap-2 flex-1">
              <div className={cn('flex-1 rounded-lg border px-3 py-2.5 text-center', stage.color)}>
                <div className="text-lg font-bold">{stage.count}</div>
                <div className="text-xs opacity-80">{stage.label}</div>
              </div>
              {i < 3 && (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4 text-white/20 flex-shrink-0 self-center rotate-90 md:rotate-0">
                  <path strokeLinecap="round" d="M9 18l6-6-6-6" />
                </svg>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Strategies Table */}
      <div className="bg-[#111111] border border-white/10 rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-white/8">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-white">Strategies</h2>
            <div className="flex flex-wrap items-center gap-1 text-[11px] text-white/35">
              {([
                ['name', 'Name'],
                ['status', 'Status'],
                ['score', 'Score'],
                ['trades', 'Trades'],
                ['updated_at', 'Updated'],
              ] as const).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => toggleSort(key)}
                  className="rounded-md border border-white/10 px-2 py-1 hover:text-white hover:border-white/20 transition-colors"
                >
                  {label}
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
                <th className="px-4 py-3 text-left text-xs font-medium text-white/40 uppercase tracking-wider">ID</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-white/40 uppercase tracking-wider">Name</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-white/40 uppercase tracking-wider">Version</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-white/40 uppercase tracking-wider">Status</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-white/40 uppercase tracking-wider">Params</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-white/40 uppercase tracking-wider">Updated</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-white/40 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                Array.from({ length: 4 }).map((_, i) => <SkeletonRow key={i} />)
              ) : displayStrategies.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-white/30">
                    <div className="flex flex-col items-center gap-2">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-8 h-8 text-white/20">
                        <path strokeLinecap="round" d="M9 3H5a2 2 0 00-2 2v4m6-6h10a2 2 0 012 2v4M9 3v18m0 0h10a2 2 0 002-2V9M9 21H5a2 2 0 01-2-2V9m0 0h18" />
                      </svg>
                      <span>No strategies found — run a research cycle</span>
                    </div>
                  </td>
                </tr>
              ) : (
                displayStrategies.map((strategy) => {
                  const meta = STATUS_META[strategy.status]
                  const paramsPreview = Object.entries(strategy.params)
                    .slice(0, 2)
                    .map(([k, v]) => `${k}=${v}`)
                    .join(', ')
                  return (
                    <tr key={strategy.strategy_id} className="border-b border-white/5 hover:bg-white/[0.02] transition-colors">
                      <td className="px-4 py-3 font-mono text-xs text-white/60">{strategy.strategy_id}</td>
                      <td className="px-4 py-3 font-medium text-white">{strategy.name}</td>
                      <td className="px-4 py-3 text-white/50">v{strategy.version}</td>
                      <td className="px-4 py-3"><Badge variant={meta.variant}>{meta.label}</Badge></td>
                      <td className="px-4 py-3 font-mono text-xs text-white/40 max-w-[180px] truncate">{paramsPreview}</td>
                      <td className="px-4 py-3 text-white/40 text-xs">
                        {formatSaoPauloDateTime(strategy.updated_at)}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          {strategy.status === 'candidate' && (
                            <button
                              onClick={() => promoteMutation.mutate(strategy.strategy_id)}
                              disabled={promoteMutation.isPending}
                              className="px-2.5 py-1 rounded text-xs font-medium bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25 transition-colors border border-emerald-500/20"
                            >
                              Promote
                            </button>
                          )}
                          {strategy.status === 'active' && (
                            <button
                              onClick={() => deprecateMutation.mutate(strategy.strategy_id)}
                              disabled={deprecateMutation.isPending}
                              className="px-2.5 py-1 rounded text-xs font-medium bg-red-500/15 text-red-400 hover:bg-red-500/25 transition-colors border border-red-500/20"
                            >
                              Deprecate
                            </button>
                          )}
                        </div>
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
