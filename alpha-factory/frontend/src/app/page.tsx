'use client'

import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { EmptyState, InlineStat, MetricCard, PageHeader, Surface, StatusPill } from '@/components/product-ui'
import { formatSaoPauloDateTime, formatSaoPauloTime } from '@/lib/time'
import {
  fetchBacktests,
  fetchEvolutionTimeline,
  fetchPortfolio,
  fetchPromotionStatus,
  fetchRegimes,
  fetchSignals,
  fetchStrategyLeaderboard,
} from '@/utils/api'

interface Signal {
  asset: string
  direction: 'LONG' | 'SHORT' | 'NO_TRADE'
  explanation?: string | null
  timestamp: string
}

interface Regime {
  asset: string
  regime: string
  confidence: number
  timestamp: string
}

interface Leader {
  name: string
  strategy_id: string
  status: string
  lifecycle_state?: string | null
  latest_score?: number | null
  latest_metrics?: Record<string, number | string | null> | null
}

interface EvolutionCycle {
  id: number
  asset: string
  timeframe: string
  cycle_at: string
  baseline_active_strategy_id?: string | null
  top_candidate_strategy_id?: string | null
  promotion_attempted: boolean
  promotion_succeeded: boolean
  promotion_blockers: string[]
  current_active_strategy_id?: string | null
  leader_changed: boolean
  leader_change_reason?: string | null
}

interface BacktestRun {
  strategy_id: string | number
  asset: string
  run_at: string
  sharpe: number
  profit_factor: number
  total_trades: number
}

function fmtNumber(value: number | null | undefined, digits = 2) {
  if (value == null || Number.isNaN(value)) return '—'
  return value.toFixed(digits)
}

export default function Home() {
  const { data: signals } = useQuery<Signal[]>({ queryKey: ['signals'], queryFn: fetchSignals, staleTime: 10_000 })
  const { data: regimes } = useQuery<Regime[]>({ queryKey: ['regimes'], queryFn: fetchRegimes, staleTime: 10_000 })
  const { data: leaderboard } = useQuery<Leader[]>({ queryKey: ['leaderboard'], queryFn: fetchStrategyLeaderboard, staleTime: 15_000 })
  const { data: timeline } = useQuery<EvolutionCycle[]>({ queryKey: ['evolution-home'], queryFn: () => fetchEvolutionTimeline({ limit: 4 }), staleTime: 15_000 })
  const { data: promotion } = useQuery({ queryKey: ['promotion-home'], queryFn: () => fetchPromotionStatus(), staleTime: 10_000 })
  const { data: backtests } = useQuery<BacktestRun[]>({ queryKey: ['backtests-home'], queryFn: fetchBacktests, staleTime: 15_000 })
  const { data: portfolio } = useQuery({ queryKey: ['portfolio-home'], queryFn: fetchPortfolio, staleTime: 15_000 })

  const leader = leaderboard?.[0]
  const latestSignal = signals?.[0]
  const latestRegime = regimes?.[0]
  const latestCycle = timeline?.[0]
  const latestBacktest = backtests?.[0]

  const freshness = [
    latestSignal?.timestamp,
    latestRegime?.timestamp,
    latestCycle?.cycle_at,
    portfolio?.timestamp,
  ].filter(Boolean) as string[]

  const latestUpdate = freshness.length ? freshness.sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0] : null

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Alpha Factory · Dashboard"
        title="Current system state at a glance"
        subtitle="Track the active leader, market regime, latest signal, recent evolution, and the freshest update without digging through tables."
        status={<StatusPill tone={latestSignal?.direction === 'LONG' ? 'success' : latestSignal?.direction === 'SHORT' ? 'danger' : 'default'}>{latestSignal?.direction ?? 'NO SIGNAL'}</StatusPill>}
        action={<Link href="/evolution" className="inline-flex items-center justify-center rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-white hover:bg-white/10">View Evolution</Link>}
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <MetricCard
          label="Active Leader"
          value={leader?.name ?? 'n/a'}
          note={leader ? `${leader.lifecycle_state ?? leader.status} · ${leader.strategy_id}` : 'No leader available yet'}
          tone={leader?.status === 'active' ? 'success' : 'default'}
        />
        <MetricCard
          label="Baseline Score"
          value={fmtNumber(Number(promotion?.baseline_current_active_score ?? promotion?.baseline_proven_score ?? leader?.latest_score ?? 0), 3)}
          note={promotion?.competition_mode || 'current_active_baseline'}
          tone="info"
        />
        <MetricCard
          label="Current Regime"
          value={latestRegime ? latestRegime.regime.replace('_', ' ') : 'n/a'}
          note={latestRegime ? `${latestRegime.asset} · ${fmtNumber(latestRegime.confidence, 1)}% confidence` : 'No regime snapshot yet'}
          tone="warning"
        />
        <MetricCard
          label="Freshest Update"
          value={latestUpdate ? formatSaoPauloTime(latestUpdate) : 'n/a'}
          note={latestUpdate ? formatSaoPauloDateTime(latestUpdate) : 'Awaiting data'}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.35fr_0.95fr]">
        <Surface
          title="Decision Board"
          description="The leader, its score, and the exact reason it is or is not advancing."
          action={<StatusPill tone={promotion?.closest_to_promotion ? 'success' : 'warning'}>{promotion?.closest_to_promotion ? 'Closest to promotion' : 'Blocked by gates'}</StatusPill>}
        >
          {leader ? (
            <div className="grid gap-3 md:grid-cols-2">
              <Card className="bg-white/[0.03]">
                <div className="text-[11px] uppercase tracking-[0.22em] text-white/35">Leader</div>
                <div className="mt-2 text-xl font-semibold text-white text-balance">{leader.name}</div>
                <div className="mt-2 font-mono text-xs text-white/45 break-all">{leader.strategy_id}</div>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Badge variant={leader.lifecycle_state === 'live_limited' ? 'success' : leader.status === 'active' ? 'success' : 'warning'}>
                    {leader.lifecycle_state || leader.status}
                  </Badge>
                  <Badge variant="default">Score {fmtNumber(leader.latest_score ?? 0, 3)}</Badge>
                  <Badge variant="default">PF {fmtNumber(Number(leader.latest_metrics?.profit_factor ?? 0), 2)}</Badge>
                </div>
              </Card>

              <div className="grid gap-3">
                <div className="rounded-xl border border-white/8 bg-white/[0.02] p-4">
                  <div className="text-[11px] uppercase tracking-[0.2em] text-white/35">Latest Signal</div>
                  <div className="mt-2 flex items-center gap-2">
                    <StatusPill tone={latestSignal?.direction === 'LONG' ? 'success' : latestSignal?.direction === 'SHORT' ? 'danger' : 'default'}>
                      {latestSignal?.direction ?? 'NO SIGNAL'}
                    </StatusPill>
                    <span className="text-sm text-white/60">{latestSignal?.asset ?? 'Awaiting feed'}</span>
                  </div>
                  <p className="mt-2 text-sm leading-6 text-white/45">
                    {latestSignal?.explanation || 'No narrative attached yet. The engine is still generating live context.'}
                  </p>
                  <p className="mt-3 text-xs text-white/35">{latestSignal ? formatSaoPauloDateTime(latestSignal.timestamp) : 'n/a'}</p>
                </div>
                <div className="rounded-xl border border-white/8 bg-white/[0.02] p-4">
                  <div className="text-[11px] uppercase tracking-[0.2em] text-white/35">Promotion State</div>
                  <p className="mt-2 text-sm leading-6 text-white/60">
                    {promotion?.target?.strategy_id
                      ? `Top candidate ${promotion.target.strategy_id} is ${promotion.closest_to_promotion ? 'closest to promotion' : 'still blocked'} against the active baseline.`
                      : 'No candidate available for promotion diagnostics yet.'}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {(promotion?.blockers?.length ? promotion.blockers : ['No blockers']).slice(0, 3).map((blocker: string) => (
                      <Badge key={blocker} variant={promotion?.closest_to_promotion ? 'success' : 'warning'}>
                        {blocker}
                      </Badge>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <EmptyState
              title="No leader yet"
              description="Run the research loop to create candidate strategies and establish a current leader."
              action={<Link href="/research" className="inline-flex rounded-full border border-white/10 bg-blue-500 px-4 py-2 text-sm font-medium text-white hover:bg-blue-600">Open Research Lab</Link>}
            />
          )}
        </Surface>

        <Surface
          title="System Health"
          description="Minimal operational readout without noise."
          action={<StatusPill tone="success">Live</StatusPill>}
        >
          <div className="grid gap-3">
            <InlineStat label="Signals" value={signals?.length ?? 0} tone="info" />
            <InlineStat label="Regimes" value={regimes?.length ?? 0} tone="warning" />
            <InlineStat label="Backtests" value={backtests?.length ?? 0} />
            <InlineStat label="Positions" value={portfolio?.positions?.length ?? 0} tone="success" />
          </div>
          <div className="mt-4 rounded-xl border border-white/8 bg-white/[0.02] p-4">
            <div className="text-[11px] uppercase tracking-[0.2em] text-white/35">Latest Backtest</div>
            {latestBacktest ? (
              <div className="mt-2 space-y-2 text-sm">
                <div className="font-medium text-white text-balance">{latestBacktest.strategy_id} · {latestBacktest.asset}</div>
                <div className="flex flex-wrap gap-2">
                  <Badge variant={latestBacktest.sharpe >= 1 ? 'success' : latestBacktest.sharpe >= 0.5 ? 'warning' : 'danger'}>
                    Sharpe {fmtNumber(latestBacktest.sharpe, 2)}
                  </Badge>
                  <Badge variant="default">PF {fmtNumber(latestBacktest.profit_factor, 2)}</Badge>
                  <Badge variant="default">Trades {latestBacktest.total_trades}</Badge>
                </div>
                <p className="text-xs text-white/40">{formatSaoPauloDateTime(latestBacktest.run_at)}</p>
              </div>
            ) : (
              <p className="mt-2 text-sm text-white/45">No backtests have been recorded yet.</p>
            )}
          </div>
        </Surface>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
        <Surface
          title="Evolution Snapshot"
          description="Recent cycles and whether the leader changed, promotion was blocked, or deprecations were applied."
          action={<Link href="/evolution" className="text-sm text-blue-300 hover:text-blue-200">Open Timeline →</Link>}
        >
          <div className="space-y-3">
            {(timeline ?? []).length === 0 ? (
              <EmptyState
                title="No evolution records yet"
                description="The autonomous loop has not persisted cycle history yet."
              />
            ) : (
              (timeline ?? []).slice(0, 3).map((cycle: EvolutionCycle) => (
                <div key={cycle.id} className="rounded-2xl border border-white/8 bg-white/[0.02] p-4">
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <StatusPill tone={cycle.leader_changed ? 'success' : 'default'}>
                          {cycle.leader_changed ? 'Leader changed' : 'Leader held'}
                        </StatusPill>
                        <StatusPill tone={cycle.promotion_succeeded ? 'success' : cycle.promotion_attempted ? 'warning' : 'default'}>
                          {cycle.promotion_succeeded ? 'Promotion succeeded' : cycle.promotion_attempted ? 'Promotion blocked' : 'No promotion'}
                        </StatusPill>
                      </div>
                      <div className="mt-3 text-sm font-medium text-white">{cycle.asset} · {cycle.timeframe}</div>
                      <p className="mt-1 text-sm leading-6 text-white/45">{cycle.leader_change_reason || 'No leader change recorded'}</p>
                    </div>
                    <div className="text-xs text-white/35">{formatSaoPauloDateTime(cycle.cycle_at)}</div>
                  </div>
                  <div className="mt-4 grid gap-2 md:grid-cols-4">
                    <InlineStat label="Baseline" value={cycle.baseline_active_strategy_id ?? 'n/a'} />
                    <InlineStat label="Candidate" value={cycle.top_candidate_strategy_id ?? 'n/a'} />
                    <InlineStat label="Current Leader" value={cycle.current_active_strategy_id ?? 'n/a'} tone="success" />
                    <InlineStat label="Blockers" value={cycle.promotion_blockers.length} tone={cycle.promotion_blockers.length ? 'warning' : 'success'} />
                  </div>
                </div>
              ))
            )}
          </div>
        </Surface>

        <Surface
          title="Current Leaderboard"
          description="The current active frontier and nearby competitors."
        >
          <div className="space-y-3">
            {(leaderboard ?? []).length === 0 ? (
              <EmptyState title="No strategies ranked yet" description="Run research to populate the leaderboard." />
            ) : (
              (leaderboard ?? []).slice(0, 4).map((strategy: Leader, index: number) => (
                <div key={strategy.strategy_id} className="rounded-2xl border border-white/8 bg-white/[0.02] p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-[11px] uppercase tracking-[0.2em] text-white/35">#{index + 1}</div>
                      <div className="mt-1 truncate text-sm font-medium text-white">{strategy.name}</div>
                      <div className="mt-1 truncate font-mono text-[11px] text-white/40">{strategy.strategy_id}</div>
                    </div>
                    <Badge variant={strategy.lifecycle_state === 'live_limited' || strategy.status === 'active' ? 'success' : strategy.status === 'candidate' ? 'warning' : 'default'}>
                      {strategy.lifecycle_state || strategy.status}
                    </Badge>
                  </div>
                  <div className="mt-4 grid grid-cols-3 gap-2">
                    <InlineStat label="Score" value={fmtNumber(strategy.latest_score ?? 0, 3)} tone="info" />
                    <InlineStat label="PF" value={fmtNumber(Number(strategy.latest_metrics?.profit_factor ?? 0), 2)} />
                    <InlineStat label="Trades" value={Number(strategy.latest_metrics?.total_trades ?? 0)} />
                  </div>
                </div>
              ))
            )}
          </div>
        </Surface>
      </div>
    </div>
  )
}
