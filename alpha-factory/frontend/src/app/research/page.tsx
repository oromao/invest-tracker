'use client'

import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { EmptyState, InlineStat, MetricCard, PageHeader, Surface, StatusPill } from '@/components/product-ui'
import { SkeletonCard } from '@/components/ui/skeleton'
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

function humanizeBlocker(blocker: string): { label: string; tone: StatusVariant } {
  const lower = blocker.toLowerCase()
  if (lower.includes('trade')) return { label: `Trade count · ${blocker}`, tone: 'warning' }
  if (lower.includes('drawdown') || lower.includes('risk')) return { label: `Risk · ${blocker}`, tone: 'danger' }
  if (lower.includes('oos') || lower.includes('consistency') || lower.includes('profit') || lower.includes('score') || lower.includes('sharpe')) {
    return { label: `Performance · ${blocker}`, tone: 'warning' }
  }
  return { label: blocker, tone: 'default' }
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
  const bestStrategies = (leaderboard ?? []).slice(0, 4)
  const leadingStrategy = bestStrategies[0]

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Autonomous Research"
        title="Strategy discovery and promotion control"
        subtitle="Generate candidates, compare them against the current baseline, and surface exactly why a strategy is promoted, blocked, or deprecated."
        action={
          <button
            onClick={() => researchMutation.mutate()}
            disabled={researchMutation.isPending}
            className={cn(
              'inline-flex items-center justify-center rounded-full px-4 py-2 text-sm font-medium transition-colors',
              researchMutation.isPending
                ? 'bg-blue-500/30 text-blue-300/60 cursor-not-allowed'
                : 'bg-blue-500 text-white hover:bg-blue-600'
            )}
          >
            {researchMutation.isPending ? 'Running…' : 'Run Research Cycle'}
          </button>
        }
        status={<StatusPill tone={promotionStatus?.closest_to_promotion ? 'success' : 'warning'}>{promotionStatus?.closest_to_promotion ? 'Promotion eligible' : 'Promotion blocked'}</StatusPill>}
      />

      {isError && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          Failed to fetch strategies from API — showing the current empty or partial state.
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <MetricCard label="Active" value={active} tone="success" />
        <MetricCard label="Candidates" value={candidates} tone="warning" />
        <MetricCard label="Total Strategies" value={total} tone="info" />
        <MetricCard label="Deprecated" value={deprecated} tone="danger" />
      </div>

      <Surface
        title="Promotion diagnostics"
        description="The candidate must beat the active baseline and pass the robust gates below."
        action={<Badge variant={promotionStatus?.closest_to_promotion ? 'success' : 'warning'}>{promotionStatus?.closest_to_promotion ? 'Closest candidate' : 'Still blocked'}</Badge>}
      >
        {!promotionStatus ? (
          <div className="text-sm text-white/35">Loading promotion state…</div>
        ) : (
          <div className="grid gap-3 md:grid-cols-3">
            <InlineStat
              label="Active baseline"
              value={Number(promotionStatus.baseline_current_active_score ?? promotionStatus.baseline_proven_score ?? 0).toFixed(3)}
              tone="info"
            />
            <InlineStat
              label="Top candidate"
              value={promotionStatus.target?.strategy_id ?? 'n/a'}
              tone={promotionStatus.closest_to_promotion ? 'success' : 'warning'}
            />
            <InlineStat
              label="Competition mode"
              value={promotionStatus.competition_mode || 'current_active_baseline'}
            />
          </div>
        )}
        <div className="mt-4 grid gap-3 lg:grid-cols-[1fr_1fr]">
          <div className="rounded-2xl border border-white/8 bg-white/[0.02] p-4">
            <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-white/35">Gate outcome</div>
            <div className="mt-3 flex flex-wrap gap-2">
              {(promotionStatus?.blockers?.length ? promotionStatus.blockers : ['No blockers']).map((blocker: string) => {
                const meta = humanizeBlocker(blocker)
                return (
                  <Badge key={blocker} variant={meta.tone}>
                    {meta.label}
                  </Badge>
                )
              })}
            </div>
          </div>
          <div className="rounded-2xl border border-white/8 bg-white/[0.02] p-4">
            <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-white/35">Target snapshot</div>
            <div className="mt-3 grid gap-2 text-sm text-white/55">
              <div>
                Strategy: <span className="text-white">{promotionStatus?.target?.strategy_id ?? 'n/a'}</span>
              </div>
              <div>
                Score: <span className="text-white">{Number(promotionStatus?.target?.score ?? 0).toFixed(3)}</span>
              </div>
              <div>
                Trades: <span className="text-white">{Number(promotionStatus?.target?.total_trades ?? 0)}</span>
              </div>
              <div>
                OOS Sharpe: <span className="text-white">{Number(promotionStatus?.target?.oos_sharpe ?? 0).toFixed(2)}</span>
              </div>
            </div>
          </div>
        </div>
      </Surface>

      <Surface
        title="Best strategies"
        description="Ranked by robust score, not just win rate."
      >
        {bestStrategies.length === 0 ? (
          <EmptyState title="No ranked strategies yet" description="Run the research cycle to populate the leaderboard." />
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {bestStrategies.map((strategy, index) => (
              <Card key={strategy.strategy_id} className="bg-white/[0.02]">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[11px] uppercase tracking-[0.2em] text-white/35">#{index + 1}</div>
                    <div className="mt-1 truncate text-base font-medium text-white">{strategy.name}</div>
                    <div className="mt-1 truncate font-mono text-[11px] text-white/40">{strategy.strategy_id}</div>
                  </div>
                  <Badge variant={strategy.lifecycle_state === 'paper' || strategy.status === 'active' ? 'success' : strategy.status === 'candidate' ? 'warning' : 'default'}>
                    {strategy.lifecycle_state || strategy.status}
                  </Badge>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-4">
                  <InlineStat label="Score" value={Number(strategy.latest_score ?? 0).toFixed(3)} tone="info" />
                  <InlineStat label="Sharpe" value={Number(strategy.latest_metrics?.sharpe ?? 0).toFixed(2)} />
                  <InlineStat label="PF" value={Number(strategy.latest_metrics?.profit_factor ?? 0).toFixed(2)} />
                  <InlineStat label="Trades" value={Number(strategy.latest_metrics?.total_trades ?? 0)} />
                </div>
                <p className="mt-4 text-sm leading-6 text-white/45">
                  {strategy.latest_reason || 'No evaluation note recorded'}
                </p>
              </Card>
            ))}
          </div>
        )}
      </Surface>

      <Surface
        title="Lifecycle mix"
        description="Where the current population sits right now."
      >
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {[
            { label: 'Draft', count: drafts, tone: 'default' as const },
            { label: 'Candidate', count: candidates, tone: 'warning' as const },
            { label: 'Active', count: active, tone: 'success' as const },
            { label: 'Deprecated', count: deprecated, tone: 'danger' as const },
          ].map((stage) => (
            <div key={stage.label} className="rounded-2xl border border-white/8 bg-white/[0.02] p-4">
              <div className="text-[11px] uppercase tracking-[0.2em] text-white/35">{stage.label}</div>
              <div className={cn('mt-2 text-2xl font-semibold tabular-nums', stage.tone === 'success' ? 'text-emerald-400' : stage.tone === 'warning' ? 'text-yellow-400' : stage.tone === 'danger' ? 'text-red-400' : 'text-white')}>
                {stage.count}
              </div>
            </div>
          ))}
        </div>
        <div className="mt-4 text-xs leading-6 text-white/40">
          The research loop keeps searching after promotion. Weak strategies can still be deprecated automatically when recent evidence degrades.
        </div>
      </Surface>

      <Surface
        title="Strategy inventory"
        description="Search, sort, and act on the current strategy set."
      >
        <div className="grid grid-cols-1 gap-3 md:grid-cols-[1.4fr_0.7fr_0.7fr]">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search strategy, reason or ID…"
            className="rounded-xl border border-white/10 bg-[#0f0f0f] px-3 py-3 text-sm text-white placeholder:text-white/30 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
            className="rounded-xl border border-white/10 bg-[#0f0f0f] px-3 py-3 text-sm text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            <option value="all">All statuses</option>
            <option value="draft">Draft</option>
            <option value="candidate">Candidate</option>
            <option value="active">Active</option>
            <option value="deprecated">Deprecated</option>
          </select>
          <div className="flex gap-2">
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
                className="flex-1 rounded-xl border border-white/10 px-2 py-3 text-xs uppercase tracking-[0.18em] text-white/45 transition-colors hover:border-white/20 hover:text-white"
              >
                {label}
                {sortKey === key ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''}
              </button>
            ))}
          </div>
        </div>

        {isLoading ? (
          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <SkeletonCard key={i} />
            ))}
          </div>
        ) : displayStrategies.length === 0 ? (
          <div className="mt-4">
            <EmptyState
              title="No strategies found"
              description="Run a research cycle or clear the filters to surface strategies."
            />
          </div>
        ) : (
          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            {displayStrategies.map((strategy) => {
              const meta = STATUS_META[strategy.status]
              const paramsPreview = Object.entries(strategy.params)
                .slice(0, 2)
                .map(([k, v]) => `${k}=${v}`)
                .join(' · ')
              return (
                <Card key={strategy.strategy_id} className="bg-white/[0.02]">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-base font-medium text-white">{strategy.name}</div>
                      <div className="mt-1 font-mono text-[11px] text-white/40 break-all">{strategy.strategy_id}</div>
                    </div>
                    <Badge variant={meta.variant}>{meta.label}</Badge>
                  </div>
                  <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-4">
                    <InlineStat label="Version" value={`v${strategy.version}`} />
                    <InlineStat label="Score" value={Number(strategy.latest_score ?? 0).toFixed(3)} tone="info" />
                    <InlineStat label="Trades" value={Number(strategy.latest_metrics?.total_trades ?? 0)} />
                    <InlineStat label="Updated" value={formatSaoPauloDateTime(strategy.updated_at)} />
                  </div>
                  <div className="mt-4 rounded-xl border border-white/8 bg-white/[0.02] p-3 text-sm text-white/50">
                    {paramsPreview || 'No parameters recorded'}
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {strategy.status === 'candidate' && (
                      <button
                        onClick={() => promoteMutation.mutate(strategy.strategy_id)}
                        disabled={promoteMutation.isPending}
                        className="rounded-full border border-emerald-500/20 bg-emerald-500/15 px-3 py-2 text-xs font-medium text-emerald-300 hover:bg-emerald-500/25 disabled:opacity-60"
                      >
                        Promote
                      </button>
                    )}
                    {strategy.status === 'active' && (
                      <button
                        onClick={() => deprecateMutation.mutate(strategy.strategy_id)}
                        disabled={deprecateMutation.isPending}
                        className="rounded-full border border-red-500/20 bg-red-500/15 px-3 py-2 text-xs font-medium text-red-300 hover:bg-red-500/25 disabled:opacity-60"
                      >
                        Deprecate
                      </button>
                    )}
                    <Badge variant="default">{strategy.latest_reason || 'No evaluation note'}</Badge>
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
