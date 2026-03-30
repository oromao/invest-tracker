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
  fetchHealth,
  fetchPortfolio,
  fetchPromotionStatus,
  fetchRegimes,
  fetchSignals,
  fetchStrategyLeaderboard,
} from '@/utils/api'

interface Signal {
  id: string
  asset: string
  direction: 'LONG' | 'SHORT' | 'NO_TRADE'
  confidence?: number
  regime?: string | null
  explanation?: string | null
  rag_context?: string | null
  timeframe?: string | null
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
  latest_reason?: string | null
  latest_metrics?: Record<string, number | string | null> | null
  updated_at?: string
}

interface EvolutionCycle {
  id: number
  asset: string
  timeframe: string
  cycle_at: string
  baseline_active_strategy_id?: string | null
  baseline_active_score?: number | null
  top_candidate_strategy_id?: string | null
  top_candidate_score?: number | null
  promotion_attempted: boolean
  promotion_succeeded: boolean
  promotion_blockers: string[]
  deprecated_strategy_ids: string[]
  competition_mode?: string | null
  previous_active_strategy_id?: string | null
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
  max_drawdown: number
  total_trades: number
}

interface PortfolioPosition {
  asset: string
  side?: 'LONG' | 'SHORT'
  direction?: string
  size: number
  entry_price: number
  current_price?: number
  pnl?: number
  pnl_pct: number
  last_signal_id?: string | null
}

interface PortfolioSummary {
  total_value: number
  cash?: number
  invested?: number
  open_pnl?: number
  daily_pnl?: number
  daily_pnl_pct?: number
  total_pnl?: number
  total_pnl_pct?: number
  active_positions?: number
  positions: PortfolioPosition[]
  timestamp?: string
}

interface HealthResponse {
  status: string
  version?: string
  dry_run?: boolean
  timestamp: string
  checks?: {
    database?: string
    redis?: string
    data_freshness?: Record<string, string> | string
    scheduler?: { running?: boolean; jobs?: number } | string
    scheduler_heartbeats?: Record<string, string> | string
    paper_trading?: {
      total_trades?: number
      win_rate?: number
      total_pnl?: number
      max_drawdown?: number
      instability?: boolean
    } | string
    drift?: Record<string, { has_drift?: boolean; regime_unstable?: boolean }> | string
  }
}

function toNumber(value: unknown, fallback = 0): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function fmtNumber(value: number | null | undefined, digits = 2) {
  if (value == null || Number.isNaN(value)) return '—'
  return value.toFixed(digits)
}

function fmtSigned(value: number, digits = 2) {
  const formatted = value.toFixed(digits)
  return value > 0 ? `+${formatted}` : formatted
}

function fmtBRL(n: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(n)
}

function normalizeConfidence(value: number): number {
  return Math.abs(value) <= 1 ? value * 100 : value
}

function confidenceTone(confidence: number) {
  if (confidence >= 70) return 'success'
  if (confidence >= 45) return 'warning'
  return 'danger'
}

function blockerTone(blocker: string): 'warning' | 'danger' | 'info' {
  const lower = blocker.toLowerCase()
  if (lower.includes('drawdown') || lower.includes('risk') || lower.includes('loss')) return 'danger'
  if (lower.includes('data') || lower.includes('fresh') || lower.includes('stale')) return 'info'
  return 'warning'
}

function classifySignal(direction?: string) {
  if (direction === 'LONG') return 'success' as const
  if (direction === 'SHORT') return 'danger' as const
  return 'default' as const
}

function formatMaybeTimestamp(value?: string | null) {
  return value ? formatSaoPauloDateTime(value) : 'n/a'
}

function shortId(value?: string | null) {
  if (!value) return 'n/a'
  if (value.length <= 24) return value
  return `${value.slice(0, 10)}…${value.slice(-8)}`
}

function formatSignalDirection(value: string) {
  return value.replace('_', ' ')
}

export default function Home() {
  const { data: signals } = useQuery<Signal[]>({
    queryKey: ['signals'],
    queryFn: fetchSignals,
    staleTime: 10_000,
  })
  const { data: regimes } = useQuery<Regime[]>({
    queryKey: ['regimes'],
    queryFn: fetchRegimes,
    staleTime: 10_000,
  })
  const { data: leaderboard } = useQuery<Leader[]>({
    queryKey: ['leaderboard'],
    queryFn: fetchStrategyLeaderboard,
    staleTime: 15_000,
  })
  const { data: timeline } = useQuery<EvolutionCycle[]>({
    queryKey: ['evolution-home'],
    queryFn: () => fetchEvolutionTimeline({ limit: 4 }),
    staleTime: 15_000,
  })
  const { data: promotion } = useQuery({
    queryKey: ['promotion-home'],
    queryFn: () => fetchPromotionStatus(),
    staleTime: 10_000,
  })
  const { data: backtests } = useQuery<BacktestRun[]>({
    queryKey: ['backtests-home'],
    queryFn: fetchBacktests,
    staleTime: 15_000,
  })
  const { data: portfolio } = useQuery<PortfolioSummary>({
    queryKey: ['portfolio-home'],
    queryFn: fetchPortfolio,
    staleTime: 15_000,
  })
  const { data: health } = useQuery<HealthResponse>({
    queryKey: ['health'],
    queryFn: fetchHealth,
    staleTime: 10_000,
    refetchInterval: 20_000,
  })

  const leader = leaderboard?.[0]
  const topCandidate = promotion?.target?.strategy_id ? promotion.target : leaderboard?.[1]
  const latestSignal = signals?.[0]
  const latestRegime = regimes?.[0]
  const latestCycle = timeline?.[0]
  const latestBacktest = backtests?.[0]

  const signalCounts = {
    LONG: signals?.filter((signal) => signal.direction === 'LONG').length ?? 0,
    SHORT: signals?.filter((signal) => signal.direction === 'SHORT').length ?? 0,
    NO_TRADE: signals?.filter((signal) => signal.direction === 'NO_TRADE').length ?? 0,
  }

  const positions = portfolio?.positions ?? []
  const longCount = positions.filter((position) => (position.side ?? position.direction) === 'LONG').length
  const shortCount = positions.filter((position) => (position.side ?? position.direction) === 'SHORT').length
  const openNotional = positions.reduce((sum, position) => sum + position.entry_price * position.size, 0)
  const largestPosition = positions.reduce<PortfolioPosition | null>((acc, position) => {
    if (!acc) return position
    return position.entry_price * position.size > acc.entry_price * acc.size ? position : acc
  }, null)

  const freshnessSources = [
    latestSignal?.timestamp,
    latestRegime?.timestamp,
    latestCycle?.cycle_at,
    portfolio?.timestamp,
  ].filter(Boolean) as string[]
  const latestUpdate = freshnessSources.length
    ? freshnessSources.sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0]
    : null

  const baselineScore = toNumber(promotion?.baseline_current_active_score ?? promotion?.baseline_proven_score ?? leader?.latest_score)
  const candidateScore = toNumber(promotion?.target?.score ?? topCandidate?.latest_score)
  const scoreGap = candidateScore - baselineScore

  const healthChecks = health?.checks ?? {}
  const dataFreshness =
    healthChecks.data_freshness && typeof healthChecks.data_freshness === 'object'
      ? Object.entries(healthChecks.data_freshness)
      : []
  const staleHeartbeats =
    healthChecks.scheduler_heartbeats && typeof healthChecks.scheduler_heartbeats === 'object'
      ? Object.entries(healthChecks.scheduler_heartbeats)
      : []
  const driftEntries =
    healthChecks.drift && typeof healthChecks.drift === 'object'
      ? Object.entries(healthChecks.drift)
      : []
  const scheduler = healthChecks.scheduler && typeof healthChecks.scheduler === 'object' ? healthChecks.scheduler : null
  const paperStats =
    healthChecks.paper_trading && typeof healthChecks.paper_trading === 'object' ? healthChecks.paper_trading : null

  const opsTone = health?.status === 'ok' && staleHeartbeats.length === 0 ? 'success' : 'warning'
  const leadTone =
    promotion?.closest_to_promotion || (topCandidate && candidateScore >= baselineScore) ? 'success' : 'warning'

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Alpha Factory · Dashboard"
        title="Decision surface for the autonomous trading loop"
        subtitle="Read the active leader, the strongest challenger, the regime backdrop, and the system health in one pass."
        status={<StatusPill tone={opsTone}>{health?.status === 'ok' ? 'Loop healthy' : 'Loop degraded'}</StatusPill>}
        action={
          <Link
            href="/evolution"
            className="inline-flex items-center justify-center rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-white hover:bg-white/10"
          >
            View Evolution
          </Link>
        }
      />

      <div className="grid gap-4 xl:grid-cols-[1.35fr_0.95fr]">
        <Surface
          title="Executive Readout"
          description="Leader, challenger, regime, and the latest autonomous cycle."
          action={<StatusPill tone={leadTone}>{promotion?.closest_to_promotion ? 'Closest to promotion' : 'Blocked by gates'}</StatusPill>}
        >
          <div className="grid gap-4 lg:grid-cols-[1.25fr_0.75fr]">
            <Card className="bg-white/[0.02]">
              <div className="flex flex-wrap items-center gap-2">
                <StatusPill tone={leader?.status === 'active' ? 'success' : 'warning'}>
                  {leader ? `${leader.lifecycle_state ?? leader.status}` : 'No leader'}
                </StatusPill>
                <Badge variant="default">Baseline {fmtNumber(baselineScore, 3)}</Badge>
                <Badge variant={candidateScore >= baselineScore ? 'success' : 'warning'}>
                  Candidate {fmtNumber(candidateScore, 3)}
                </Badge>
              </div>

              <div className="mt-4 min-w-0">
                <div className="text-[11px] uppercase tracking-[0.22em] text-white/35">Current leader</div>
                <div className="mt-2 break-words text-2xl font-semibold tracking-tight text-white text-balance">
                  {leader?.name ?? 'No leader available yet'}
                </div>
                <div className="mt-2 break-all font-mono text-[11px] text-white/40">{leader?.strategy_id ?? 'n/a'}</div>
                <p className="mt-3 text-sm leading-6 text-white/55 text-pretty">
                  {leader?.latest_reason || 'Run research to establish a validated leader and surface the reason it remains active.'}
                </p>
              </div>

              <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                <InlineStat label="Score" value={fmtNumber(leader?.latest_score ?? baselineScore, 3)} tone="info" />
                <InlineStat label="Profit Factor" value={fmtNumber(toNumber(leader?.latest_metrics?.profit_factor), 2)} />
                <InlineStat label="Trades" value={Number(leader?.latest_metrics?.total_trades ?? 0)} />
                <InlineStat label="Last Updated" value={formatMaybeTimestamp(leader?.updated_at)} />
              </div>

              <div className="mt-4 rounded-2xl border border-white/8 bg-white/[0.02] p-4">
                <div className="text-[11px] uppercase tracking-[0.2em] text-white/35">Why it still leads</div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {(leader?.latest_reason ? [leader.latest_reason] : ['No reason recorded']).slice(0, 3).map((reason) => (
                    <Badge key={reason} variant={leader ? 'success' : 'default'}>
                      {reason}
                    </Badge>
                  ))}
                </div>
              </div>
            </Card>

            <div className="grid gap-3">
              <Card className="bg-white/[0.02]">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-[11px] uppercase tracking-[0.2em] text-white/35">Top candidate</div>
                    <div className="mt-1 text-lg font-semibold text-white text-balance">
                      {promotion?.target?.strategy_id ?? topCandidate?.strategy_id ?? 'n/a'}
                    </div>
                  </div>
                  <Badge variant={promotion?.closest_to_promotion ? 'success' : 'warning'}>
                    {promotion?.closest_to_promotion ? 'Near promotion' : 'Blocked'}
                  </Badge>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-2">
                  <InlineStat label="Score" value={fmtNumber(candidateScore, 3)} tone={promotion?.closest_to_promotion ? 'success' : 'warning'} />
                  <InlineStat label="Gap vs baseline" value={fmtSigned(scoreGap, 3)} tone={scoreGap >= 0 ? 'success' : 'danger'} />
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  {(promotion?.blockers?.length ? promotion.blockers : ['No blockers']).slice(0, 3).map((blocker: string) => (
                    <Badge key={blocker} variant={blockerTone(blocker)}>
                      {blocker}
                    </Badge>
                  ))}
                </div>
              </Card>

              <Card className="bg-white/[0.02]">
                <div className="text-[11px] uppercase tracking-[0.2em] text-white/35">Market regime</div>
                <div className="mt-2 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-lg font-semibold text-white text-balance">
                      {latestRegime ? latestRegime.regime.replaceAll('_', ' ') : 'n/a'}
                    </div>
                    <div className="mt-1 text-sm text-white/55">
                      {latestRegime ? `${latestRegime.asset} · ${fmtNumber(normalizeConfidence(latestRegime.confidence), 1)}% confidence` : 'No regime snapshot yet'}
                    </div>
                  </div>
                  <Badge variant={latestRegime ? 'info' : 'default'}>{latestRegime ? latestRegime.asset : '—'}</Badge>
                </div>
                <div className="mt-3 text-xs text-white/40">{formatMaybeTimestamp(latestRegime?.timestamp)}</div>
              </Card>

              <Card className="bg-white/[0.02]">
                <div className="text-[11px] uppercase tracking-[0.2em] text-white/35">Last autonomous cycle</div>
                <div className="mt-2 flex items-center gap-2">
                  <StatusPill tone={latestCycle?.leader_changed ? 'success' : 'default'}>
                    {latestCycle?.leader_changed ? 'Leader changed' : 'Leader held'}
                  </StatusPill>
                  <StatusPill tone={latestCycle?.promotion_succeeded ? 'success' : latestCycle?.promotion_attempted ? 'warning' : 'default'}>
                    {latestCycle?.promotion_succeeded ? 'Promotion succeeded' : latestCycle?.promotion_attempted ? 'Promotion blocked' : 'No promotion'}
                  </StatusPill>
                </div>
                <div className="mt-4 grid gap-2">
                  <InlineStat label="Cycle timestamp" value={formatMaybeTimestamp(latestCycle?.cycle_at)} />
                  <InlineStat label="Competition mode" value={latestCycle?.competition_mode || 'current_active_baseline'} />
                  <InlineStat label="Deprecations" value={latestCycle?.deprecated_strategy_ids?.length ?? 0} tone={latestCycle?.deprecated_strategy_ids?.length ? 'warning' : 'success'} />
                </div>
              </Card>
            </div>
          </div>
        </Surface>

        <Surface
          title="Operations / Risk"
          description="Real health from the backend, scheduler, and freshness watchdog."
          action={<StatusPill tone={opsTone}>{health?.dry_run ? 'Dry run' : 'Live mode'}</StatusPill>}
        >
          <div className="grid grid-cols-2 gap-3">
            <InlineStat label="Database" value={healthChecks.database === 'ok' ? 'OK' : 'WARN'} tone={healthChecks.database === 'ok' ? 'success' : 'warning'} />
            <InlineStat label="Redis" value={healthChecks.redis === 'ok' ? 'OK' : 'WARN'} tone={healthChecks.redis === 'ok' ? 'success' : 'warning'} />
            <InlineStat label="Scheduler" value={scheduler?.running ? `${scheduler.jobs ?? 0} jobs` : 'Stopped'} tone={scheduler?.running ? 'success' : 'danger'} />
            <InlineStat label="Heartbeats" value={staleHeartbeats.length ? `${staleHeartbeats.length} stale` : 'Fresh'} tone={staleHeartbeats.length ? 'warning' : 'success'} />
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <Card className="bg-white/[0.02]">
              <div className="text-[11px] uppercase tracking-[0.2em] text-white/35">Signal distribution</div>
              <div className="mt-3 grid gap-2 sm:grid-cols-3">
                <InlineStat label="LONG" value={signalCounts.LONG} tone="success" />
                <InlineStat label="SHORT" value={signalCounts.SHORT} tone="danger" />
                <InlineStat label="NO TRADE" value={signalCounts.NO_TRADE} tone="default" />
              </div>
              <div className="mt-3 text-xs text-white/40">
                Latest signal: {latestSignal ? `${latestSignal.asset} · ${formatSignalDirection(latestSignal.direction)} · ${formatMaybeTimestamp(latestSignal.timestamp)}` : 'No live signal yet'}
              </div>
            </Card>

            <Card className="bg-white/[0.02]">
              <div className="text-[11px] uppercase tracking-[0.2em] text-white/35">Freshness watchdog</div>
              <div className="mt-3 space-y-2">
                {dataFreshness.length ? (
                  dataFreshness.map(([asset, value]) => (
                    <div key={asset} className="flex items-center justify-between gap-2 rounded-xl border border-white/8 bg-white/[0.02] px-3 py-2 text-sm">
                      <span className="text-white/65">{asset}</span>
                      <span className="font-medium text-white">{value}</span>
                    </div>
                  ))
                ) : (
                  <div className="text-sm text-white/45">Freshness data unavailable.</div>
                )}
              </div>
            </Card>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <Card className="bg-white/[0.02]">
              <div className="text-[11px] uppercase tracking-[0.2em] text-white/35">Paper trading</div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <InlineStat label="Trades" value={paperStats?.total_trades ?? '—'} />
                <InlineStat label="Win rate" value={paperStats?.win_rate != null ? `${(paperStats.win_rate * 100).toFixed(1)}%` : '—'} />
                <InlineStat label="PnL" value={paperStats?.total_pnl != null ? fmtBRL(toNumber(paperStats.total_pnl)) : '—'} tone={toNumber(paperStats?.total_pnl) >= 0 ? 'success' : 'danger'} />
                <InlineStat label="Max DD" value={paperStats?.max_drawdown != null ? `${(paperStats.max_drawdown * 100).toFixed(1)}%` : '—'} tone="warning" />
              </div>
            </Card>

            <Card className="bg-white/[0.02]">
              <div className="text-[11px] uppercase tracking-[0.2em] text-white/35">Risk drift</div>
              <div className="mt-3 space-y-2">
                {driftEntries.length ? (
                  driftEntries.map(([key, value]) => (
                    <div key={key} className="flex items-center justify-between gap-2 rounded-xl border border-white/8 bg-white/[0.02] px-3 py-2 text-sm">
                      <span className="text-white/65">{key}</span>
                      <span className="font-medium text-white">
                        {value.has_drift || value.regime_unstable ? 'Warning' : 'Clean'}
                      </span>
                    </div>
                  ))
                ) : (
                  <div className="text-sm text-white/45">No drift flags recorded.</div>
                )}
              </div>
            </Card>
          </div>

          <div className="mt-4 rounded-2xl border border-white/8 bg-white/[0.02] p-4">
            <div className="text-[11px] uppercase tracking-[0.2em] text-white/35">Operational notes</div>
            <div className="mt-3 flex flex-wrap gap-2">
              <Badge variant={health?.status === 'ok' ? 'success' : 'warning'}>{health?.status === 'ok' ? 'System healthy' : 'System degraded'}</Badge>
              <Badge variant="default">{health?.version ?? 'v0.2.0'}</Badge>
              <Badge variant="default">{health?.timestamp ? formatMaybeTimestamp(health.timestamp) : 'n/a'}</Badge>
            </div>
            {staleHeartbeats.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {staleHeartbeats.slice(0, 3).map(([job, value]) => (
                  <Badge key={job} variant="warning">
                    {job}: {value}
                  </Badge>
                ))}
              </div>
            )}
          </div>
        </Surface>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
        <Surface
          title="Strategy performance"
          description="Compare the current frontier using real leaderboard and backtest evidence."
          action={<Link href="/research" className="text-sm text-blue-300 hover:text-blue-200">Open Research Lab →</Link>}
        >
          <div className="space-y-3">
            {(leaderboard ?? []).length === 0 ? (
              <EmptyState title="No strategies ranked yet" description="Run research to populate the leaderboard." />
            ) : (
              (leaderboard ?? []).slice(0, 4).map((strategy, index) => (
                <Card key={strategy.strategy_id} className="bg-white/[0.02]">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-[11px] uppercase tracking-[0.2em] text-white/35">#{index + 1}</div>
                      <div className="mt-1 break-words text-base font-medium text-white text-balance">{strategy.name}</div>
                      <div className="mt-1 break-all font-mono text-[11px] text-white/40">{strategy.strategy_id}</div>
                    </div>
                    <Badge variant={strategy.lifecycle_state === 'live_limited' || strategy.status === 'active' ? 'success' : strategy.status === 'candidate' ? 'warning' : 'default'}>
                      {strategy.lifecycle_state || strategy.status}
                    </Badge>
                  </div>
                  <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-4">
                    <InlineStat label="Score" value={fmtNumber(strategy.latest_score ?? 0, 3)} tone="info" />
                    <InlineStat label="PF" value={fmtNumber(toNumber(strategy.latest_metrics?.profit_factor), 2)} tone="success" />
                    <InlineStat label="Max DD" value={strategy.latest_metrics?.max_drawdown != null ? `${fmtNumber(toNumber(strategy.latest_metrics.max_drawdown), 2)}%` : '—'} tone="warning" />
                    <InlineStat label="Trades" value={Number(strategy.latest_metrics?.total_trades ?? 0)} />
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Badge variant="default">Reason: {strategy.latest_reason || 'No evaluation note'}</Badge>
                  </div>
                </Card>
              ))
            )}
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <Card className="bg-white/[0.02]">
              <div className="text-[11px] uppercase tracking-[0.2em] text-white/35">Recent backtest</div>
              {latestBacktest ? (
                <div className="mt-3 space-y-3">
                  <div className="text-lg font-semibold text-white text-balance">
                    {shortId(String(latestBacktest.strategy_id))} · {latestBacktest.asset}
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <InlineStat label="Sharpe" value={fmtNumber(latestBacktest.sharpe, 2)} tone={latestBacktest.sharpe >= 1 ? 'success' : latestBacktest.sharpe >= 0.5 ? 'warning' : 'danger'} />
                    <InlineStat label="PF" value={fmtNumber(latestBacktest.profit_factor, 2)} tone="success" />
                    <InlineStat label="Max DD" value={`${fmtNumber(latestBacktest.max_drawdown, 1)}%`} tone="warning" />
                    <InlineStat label="Trades" value={latestBacktest.total_trades} />
                  </div>
                  <div className="text-xs text-white/40">{formatMaybeTimestamp(latestBacktest.run_at)}</div>
                </div>
              ) : (
                <p className="mt-3 text-sm text-white/45">No backtest results have been recorded yet.</p>
              )}
            </Card>

            <Card className="bg-white/[0.02]">
              <div className="text-[11px] uppercase tracking-[0.2em] text-white/35">Latest cycle outcome</div>
              {latestCycle ? (
                <div className="mt-3 space-y-3">
                  <div className="flex flex-wrap gap-2">
                    <Badge variant={latestCycle.leader_changed ? 'success' : 'default'}>
                      {latestCycle.leader_changed ? 'Replacement' : 'Held'}
                    </Badge>
                    <Badge variant={latestCycle.promotion_succeeded ? 'success' : latestCycle.promotion_attempted ? 'warning' : 'default'}>
                      {latestCycle.promotion_succeeded ? 'Promoted' : latestCycle.promotion_attempted ? 'Blocked' : 'No promotion'}
                    </Badge>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <InlineStat label="Baseline" value={shortId(latestCycle.baseline_active_strategy_id)} />
                    <InlineStat label="Candidate" value={shortId(latestCycle.top_candidate_strategy_id)} tone={latestCycle.promotion_succeeded ? 'success' : 'warning'} />
                    <InlineStat label="Leader" value={shortId(latestCycle.current_active_strategy_id)} tone="success" />
                    <InlineStat label="Blockers" value={latestCycle.promotion_blockers.length} tone={latestCycle.promotion_blockers.length ? 'warning' : 'success'} />
                  </div>
                  <div className="text-xs text-white/40">{formatMaybeTimestamp(latestCycle.cycle_at)}</div>
                </div>
              ) : (
                <p className="mt-3 text-sm text-white/45">No evolution cycle recorded yet.</p>
              )}
            </Card>
          </div>
        </Surface>

        <Surface
          title="Portfolio / Exposure"
          description="Real position data with a clean exposure view. Allocation by strategy is not stored, so exposure is shown by open notional."
          action={<StatusPill tone={positions.length ? 'success' : 'default'}>{positions.length ? 'Open book' : 'Flat book'}</StatusPill>}
        >
          <div className="grid grid-cols-2 gap-3">
            <MetricCard label="Total Value" value={fmtBRL(portfolio?.total_value ?? 0)} />
            <MetricCard label="Open PnL" value={`${(portfolio?.open_pnl ?? 0) >= 0 ? '+' : ''}${fmtBRL(portfolio?.open_pnl ?? 0)}`} tone={(portfolio?.open_pnl ?? 0) >= 0 ? 'success' : 'danger'} />
            <MetricCard label="Long / Short" value={`${longCount}/${shortCount}`} tone="info" />
            <MetricCard label="Positions" value={portfolio?.active_positions ?? 0} tone="warning" />
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <Card className="bg-white/[0.02]">
              <div className="text-[11px] uppercase tracking-[0.2em] text-white/35">Exposure summary</div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <InlineStat label="Invested" value={fmtBRL(portfolio?.invested ?? 0)} />
                <InlineStat label="Daily PnL" value={`${(portfolio?.daily_pnl ?? 0) >= 0 ? '+' : ''}${fmtBRL(portfolio?.daily_pnl ?? 0)}`} tone={(portfolio?.daily_pnl ?? 0) >= 0 ? 'success' : 'danger'} />
                <InlineStat label="Total PnL" value={`${(portfolio?.total_pnl ?? 0) >= 0 ? '+' : ''}${fmtBRL(portfolio?.total_pnl ?? 0)}`} tone={(portfolio?.total_pnl ?? 0) >= 0 ? 'success' : 'danger'} />
                <InlineStat label="Signal Link" value={latestSignal?.id ?? 'n/a'} />
              </div>
              <p className="mt-3 text-xs leading-6 text-white/40">
                Allocation is proxied by open notional because strategy-level weights are not stored here.
              </p>
            </Card>

            <Card className="bg-white/[0.02]">
              <div className="text-[11px] uppercase tracking-[0.2em] text-white/35">Concentration</div>
              {largestPosition ? (
                <div className="mt-3 space-y-3">
                  <div className="text-lg font-semibold text-white text-balance">{largestPosition.asset}</div>
                  <div className="grid grid-cols-2 gap-2">
                    <InlineStat label="Side" value={(largestPosition.side ?? largestPosition.direction ?? 'LONG').toString()} tone={(largestPosition.side ?? largestPosition.direction) === 'SHORT' ? 'danger' : 'success'} />
                    <InlineStat label="Notional" value={fmtBRL(largestPosition.entry_price * largestPosition.size)} />
                    <InlineStat label="PnL" value={`${(largestPosition.pnl ?? 0) >= 0 ? '+' : ''}${fmtBRL(largestPosition.pnl ?? 0)}`} tone={(largestPosition.pnl ?? 0) >= 0 ? 'success' : 'danger'} />
                    <InlineStat label="PnL %" value={`${fmtNumber(largestPosition.pnl_pct, 2)}%`} tone={largestPosition.pnl_pct >= 0 ? 'success' : 'danger'} />
                  </div>
                </div>
              ) : (
                <EmptyState title="No open positions" description="The book is flat, so there is no concentration to highlight." />
              )}
            </Card>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <MetricCard label="Signal LONG" value={signalCounts.LONG} tone="success" />
            <MetricCard label="Signal SHORT" value={signalCounts.SHORT} tone="danger" />
            <MetricCard label="Signal NO TRADE" value={signalCounts.NO_TRADE} tone="default" />
          </div>

          <div className="mt-4 text-xs text-white/40">
            Latest portfolio update: {portfolio?.timestamp ? formatMaybeTimestamp(portfolio.timestamp) : 'n/a'}
          </div>
        </Surface>
      </div>
    </div>
  )
}
