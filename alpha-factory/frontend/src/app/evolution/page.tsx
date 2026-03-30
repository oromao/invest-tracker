'use client'

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Badge } from '@/components/ui/badge'
import { EmptyState, InlineStat, MetricCard, PageHeader, Surface, StatusPill } from '@/components/product-ui'
import { SkeletonCard } from '@/components/ui/skeleton'
import { formatSaoPauloDateTime } from '@/lib/time'
import { fetchEvolutionTimeline } from '@/utils/api'

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
  promotion_diagnostics?: {
    blockers?: string[]
    gates?: Record<string, boolean>
    closest_to_promotion?: boolean
  } | null
  created_at: string
}

function humanizeBlocker(blocker: string): { label: string; tone: 'warning' | 'danger' | 'info' } {
  const lower = blocker.toLowerCase()
  if (lower.includes('drawdown') || lower.includes('risk') || lower.includes('loss')) {
    return { label: `Risk · ${blocker}`, tone: 'danger' }
  }
  if (lower.includes('trade') || lower.includes('score') || lower.includes('profit') || lower.includes('sharpe') || lower.includes('consistency') || lower.includes('oos')) {
    return { label: `Performance · ${blocker}`, tone: 'warning' }
  }
  if (lower.includes('data') || lower.includes('fresh') || lower.includes('stale')) {
    return { label: `Data · ${blocker}`, tone: 'info' }
  }
  return { label: blocker, tone: 'warning' }
}

export default function EvolutionPage() {
  const [asset, setAsset] = useState('all')
  const [timeframe, setTimeframe] = useState('all')

  const { data: cycles, isLoading, isError } = useQuery<EvolutionCycle[]>({
    queryKey: ['evolution-timeline', asset, timeframe],
    queryFn: () =>
      fetchEvolutionTimeline({
        asset: asset === 'all' ? undefined : asset,
        timeframe: timeframe === 'all' ? undefined : timeframe,
        limit: 20,
      }),
    staleTime: 10_000,
  })

  const assets = useMemo(() => Array.from(new Set((cycles ?? []).map((c) => c.asset))), [cycles])
  const currentLeader = cycles?.find((c) => c.current_active_strategy_id)?.current_active_strategy_id ?? 'n/a'
  const replacementCount = cycles?.filter((c) => c.leader_changed).length ?? 0
  const promotions = cycles?.filter((c) => c.promotion_succeeded).length ?? 0
  const blockers = cycles?.reduce((acc, c) => acc + (c.promotion_blockers?.length ?? 0), 0) ?? 0
  const latestCycle = cycles?.[0]

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Autonomous Evolution"
        title="Strategy replacement timeline"
        subtitle="Each cycle records the baseline, strongest candidate, blockers, and whether the active leader actually changed."
        status={<StatusPill tone={replacementCount ? 'success' : 'warning'}>{replacementCount ? 'Replacement observed' : 'No replacement yet'}</StatusPill>}
      />

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-5">
        <MetricCard label="Leader Changes" value={replacementCount} tone={replacementCount ? 'success' : 'default'} />
        <MetricCard label="Promotions" value={promotions} tone="success" />
        <MetricCard label="Blockers" value={blockers} tone="warning" />
        <MetricCard label="Tracked Assets" value={assets.length} tone="info" />
        <MetricCard label="Current Leader" value={currentLeader} note={latestCycle ? formatSaoPauloDateTime(latestCycle.cycle_at) : 'n/a'} />
      </div>

      <Surface
        title="Timeline Filters"
        description="Narrow the evolution history by asset and timeframe."
      >
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <select
            value={asset}
            onChange={(e) => setAsset(e.target.value)}
            className="rounded-xl border border-white/10 bg-[#0f0f0f] px-3 py-3 text-sm text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            <option value="all">All assets</option>
            {assets.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
          <select
            value={timeframe}
            onChange={(e) => setTimeframe(e.target.value)}
            className="rounded-xl border border-white/10 bg-[#0f0f0f] px-3 py-3 text-sm text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            <option value="all">All timeframes</option>
            {['1h', '4h', '1d'].map((tf) => (
              <option key={tf} value={tf}>
                {tf}
              </option>
            ))}
          </select>
          <div className="rounded-xl border border-white/10 bg-white/[0.02] px-3 py-3 text-xs leading-6 text-white/55">
            Cycle data is persisted in São Paulo time and shows honest promotion/denial evidence for each run.
          </div>
        </div>
      </Surface>

      {isError && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          Failed to fetch evolution timeline.
        </div>
      )}

      <Surface
        title="Recent Cycles"
        description="Leader change, candidate strength, blockers, and deprecations in one place."
      >
        {isLoading ? (
          <div className="grid gap-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <SkeletonCard key={i} />
            ))}
          </div>
        ) : (cycles ?? []).length === 0 ? (
          <EmptyState
            title="No cycles yet"
            description="Run the research loop to create evolution records and replacement evidence."
          />
        ) : (
          <div className="space-y-3">
            {(cycles ?? []).map((cycle) => (
              <article key={cycle.id} className="rounded-[1.35rem] border border-white/10 bg-[#0f0f0f] p-4 md:p-5">
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusPill tone={cycle.leader_changed ? 'success' : 'default'}>
                        {cycle.leader_changed ? 'Leader changed' : 'Leader held'}
                      </StatusPill>
                      <StatusPill tone={cycle.promotion_succeeded ? 'success' : cycle.promotion_attempted ? 'warning' : 'default'}>
                        {cycle.promotion_succeeded ? 'Promoted' : cycle.promotion_attempted ? 'Blocked' : 'No promotion'}
                      </StatusPill>
                      <Badge variant="default">{cycle.asset}</Badge>
                      <Badge variant="default">{cycle.timeframe}</Badge>
                    </div>
                    <h3 className="mt-3 text-lg font-semibold text-white text-balance">
                      {cycle.previous_active_strategy_id === cycle.current_active_strategy_id
                        ? 'Leader held the line'
                        : 'Leader replacement recorded'}
                    </h3>
                    <p className="mt-1 text-sm leading-6 text-white/50 text-pretty">
                      {cycle.leader_change_reason || 'No leader change recorded'}
                    </p>
                  </div>
                  <div className="text-xs text-white/35">{formatSaoPauloDateTime(cycle.cycle_at)}</div>
                </div>

                <div className="mt-4 grid gap-3 md:grid-cols-4">
                  <InlineStat label="Baseline" value={cycle.baseline_active_strategy_id ?? 'n/a'} />
                  <InlineStat label="Candidate" value={cycle.top_candidate_strategy_id ?? 'n/a'} />
                  <InlineStat label="Current Leader" value={cycle.current_active_strategy_id ?? 'n/a'} tone="success" />
                  <InlineStat label="Score Delta" value={cycle.baseline_active_score != null && cycle.top_candidate_score != null ? (cycle.top_candidate_score - cycle.baseline_active_score).toFixed(3) : 'n/a'} tone={cycle.promotion_succeeded ? 'success' : 'warning'} />
                </div>

                <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_1fr]">
                  <div className="rounded-2xl border border-white/8 bg-white/[0.02] p-4">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-white/35">Promotion blockers</div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {(cycle.promotion_blockers.length ? cycle.promotion_blockers : ['No blockers']).map((blocker) => {
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
                    <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-white/35">Lifecycle proof</div>
                    <div className="mt-3 grid gap-2 text-sm text-white/55">
                      <div>Previous leader: <span className="text-white">{cycle.previous_active_strategy_id ?? 'n/a'}</span></div>
                      <div>Current leader: <span className="text-white">{cycle.current_active_strategy_id ?? 'n/a'}</span></div>
                      <div>Competition mode: <span className="text-white">{cycle.competition_mode || 'current_active_baseline'}</span></div>
                    </div>
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  {cycle.deprecated_strategy_ids.length ? (
                    cycle.deprecated_strategy_ids.map((id) => (
                      <Badge key={id} variant="danger">
                        Deprecated {id}
                      </Badge>
                    ))
                  ) : (
                    <Badge variant="default">No deprecations</Badge>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}
      </Surface>
    </div>
  )
}
