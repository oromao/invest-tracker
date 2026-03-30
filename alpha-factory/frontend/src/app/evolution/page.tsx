'use client'

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Badge } from '@/components/ui/badge'
import { Card, CardTitle, CardValue } from '@/components/ui/card'
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

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Evolution Timeline</h1>
          <p className="text-sm text-white/50 mt-0.5">Cycle-by-cycle strategy replacement proof</p>
        </div>
        <div className="flex items-center gap-2 text-xs text-white/40">
          <Badge variant="success">Current leader: {currentLeader}</Badge>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 md:gap-4">
        {isLoading ? (
          Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)
        ) : (
          <>
            <Card>
              <CardTitle>Leader Changes</CardTitle>
              <CardValue className="text-emerald-400">{replacementCount}</CardValue>
            </Card>
            <Card>
              <CardTitle>Promotions</CardTitle>
              <CardValue className="text-blue-400">{promotions}</CardValue>
            </Card>
            <Card>
              <CardTitle>Blockers</CardTitle>
              <CardValue className="text-yellow-400">{blockers}</CardValue>
            </Card>
            <Card>
              <CardTitle>Tracked Assets</CardTitle>
              <CardValue>{assets.length}</CardValue>
            </Card>
          </>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <select
          value={asset}
          onChange={(e) => setAsset(e.target.value)}
          className="bg-[#111] border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
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
          className="bg-[#111] border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
        >
          <option value="all">All timeframes</option>
          {['1h', '4h', '1d'].map((tf) => (
            <option key={tf} value={tf}>
              {tf}
            </option>
          ))}
        </select>
        <div className="bg-[#111] border border-white/10 rounded-lg px-3 py-2 text-xs text-white/50">
          Timeline is ordered by Sao Paulo time and includes promotion/deprecation blockers.
        </div>
      </div>

      {isError && (
        <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-sm px-4 py-3 rounded-lg">
          Failed to fetch evolution timeline.
        </div>
      )}

      <div className="space-y-3">
        {isLoading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="rounded-xl border border-white/10 bg-[#111111] p-4 animate-pulse h-32" />
          ))
        ) : (cycles ?? []).length === 0 ? (
          <div className="rounded-xl border border-white/10 bg-[#111111] p-6 text-sm text-white/35">
            No evolution cycles yet. Run research cycles to record replacements and blockers.
          </div>
        ) : (
          (cycles ?? []).map((cycle) => (
            <div key={cycle.id} className="rounded-xl border border-white/10 bg-[#111111] p-4">
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={cycle.leader_changed ? 'success' : 'default'}>
                      {cycle.leader_changed ? 'Leader changed' : 'Leader held'}
                    </Badge>
                    <Badge variant={cycle.promotion_succeeded ? 'success' : cycle.promotion_attempted ? 'warning' : 'default'}>
                      {cycle.promotion_succeeded ? 'Promotion succeeded' : cycle.promotion_attempted ? 'Promotion blocked' : 'No promotion'}
                    </Badge>
                  </div>
                  <div className="mt-2 font-semibold text-white">
                    {cycle.asset} · {cycle.timeframe}
                  </div>
                  <div className="text-xs text-white/40">{formatSaoPauloDateTime(cycle.cycle_at)}</div>
                </div>
                <div className="text-xs text-white/45 max-w-xl">
                  {cycle.leader_change_reason || 'No leader change recorded'}
                </div>
              </div>

              <div className="mt-4 grid grid-cols-1 md:grid-cols-4 gap-3 text-sm">
                <div className="rounded-lg border border-white/10 bg-white/[0.02] p-3">
                  <div className="text-white/35 text-xs uppercase">Baseline</div>
                  <div className="text-white font-semibold">{cycle.baseline_active_strategy_id ?? 'n/a'}</div>
                  <div className="text-white/35 text-xs mt-1">{Number(cycle.baseline_active_score ?? 0).toFixed(3)}</div>
                </div>
                <div className="rounded-lg border border-white/10 bg-white/[0.02] p-3">
                  <div className="text-white/35 text-xs uppercase">Top Candidate</div>
                  <div className="text-white font-semibold">{cycle.top_candidate_strategy_id ?? 'n/a'}</div>
                  <div className="text-white/35 text-xs mt-1">{Number(cycle.top_candidate_score ?? 0).toFixed(3)}</div>
                </div>
                <div className="rounded-lg border border-white/10 bg-white/[0.02] p-3">
                  <div className="text-white/35 text-xs uppercase">Current Leader</div>
                  <div className="text-white font-semibold">{cycle.current_active_strategy_id ?? 'n/a'}</div>
                  <div className="text-white/35 text-xs mt-1">{cycle.competition_mode || 'current_active_baseline'}</div>
                </div>
                <div className="rounded-lg border border-white/10 bg-white/[0.02] p-3">
                  <div className="text-white/35 text-xs uppercase">Blockers</div>
                  <div className="text-white font-semibold">{cycle.promotion_blockers.length}</div>
                  <div className="text-white/35 text-xs mt-1">
                    {(cycle.promotion_blockers.length ? cycle.promotion_blockers : ['No blockers']).join(' • ')}
                  </div>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap gap-2 text-xs">
                {cycle.deprecated_strategy_ids.map((id) => (
                  <Badge key={id} variant="danger">
                    Deprecated: {id}
                  </Badge>
                ))}
                {!cycle.deprecated_strategy_ids.length && <Badge variant="default">No deprecations</Badge>}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
