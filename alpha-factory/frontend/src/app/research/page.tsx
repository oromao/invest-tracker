'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Badge } from '@/components/ui/badge'
import { Card, CardTitle, CardValue } from '@/components/ui/card'
import { SkeletonCard, SkeletonRow } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { formatSaoPauloDateTime } from '@/lib/time'
import {
  deprecateStrategy,
  fetchStrategies,
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

  const { data: strategies, isLoading, isError } = useQuery<Strategy[]>({
    queryKey: ['strategies'],
    queryFn: fetchStrategies,
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

  const displayStrategies = (strategies ?? []).map((strategy) => ({
    ...strategy,
    params: strategy.params ?? {},
  }))

  const active = displayStrategies.filter((s) => s.status === 'active').length
  const candidates = displayStrategies.filter((s) => s.status === 'candidate').length
  const drafts = displayStrategies.filter((s) => s.status === 'draft').length
  const deprecated = displayStrategies.filter((s) => s.status === 'deprecated').length
  const total = displayStrategies.length

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
          <h2 className="text-sm font-semibold text-white">Strategies</h2>
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
