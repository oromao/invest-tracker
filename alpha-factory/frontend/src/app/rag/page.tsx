'use client'

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { EmptyState, InlineStat, MetricCard, PageHeader, Surface, StatusPill } from '@/components/product-ui'
import { formatSaoPauloDateTime } from '@/lib/time'
import { fetchSignals } from '@/utils/api'

function normalizeConfidence(value: number): number {
  return Math.abs(value) <= 1 ? value * 100 : value
}

export default function RAGPage() {
  const [search, setSearch] = useState('')
  const { data: ragData, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ['rag-memory'],
    queryFn: fetchSignals,
    refetchInterval: 60_000,
  })

  const signals = (ragData ?? []).slice(0, 6)
  const normalizedSearch = search.trim().toLowerCase()
  const filteredSignals = useMemo(
    () =>
      normalizedSearch
        ? signals.filter((signal: any) => {
            const haystack = [signal.asset, signal.timeframe, signal.direction, signal.explanation, signal.rag_context]
              .filter(Boolean)
              .join(' ')
              .toLowerCase()
            return haystack.includes(normalizedSearch)
          })
        : signals,
    [signals, normalizedSearch]
  )

  const activeSignals = filteredSignals.filter((item: any) => item.direction !== 'NO_TRADE')
  const avgConfidence = filteredSignals.length
    ? filteredSignals.reduce((sum: number, item: any) => sum + normalizeConfidence(item.confidence ?? 0), 0) / filteredSignals.length
    : 0

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="RAG Memory"
        title="Context retrieval"
        subtitle="Recent signal context surfaced as a readable memory stream rather than a decorative lab demo."
        action={
          <button
            type="button"
            onClick={() => {
              void refetch()
            }}
            disabled={isFetching}
            className="inline-flex items-center justify-center rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-white hover:bg-white/10 disabled:opacity-60"
          >
            {isFetching ? 'Refreshing…' : 'Refresh'}
          </button>
        }
        status={<StatusPill tone={activeSignals.length ? 'success' : 'default'}>{activeSignals.length ? 'Context active' : 'No active signals'}</StatusPill>}
      />

      {isError && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          Não foi possível carregar os dados reais de RAG agora.
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <MetricCard label="Retrieved Signals" value={filteredSignals.length} tone="info" />
        <MetricCard label="Avg Confidence" value={`${avgConfidence.toFixed(1)}%`} tone="success" />
        <MetricCard label="Active Signals" value={activeSignals.length} tone="warning" />
        <MetricCard label="Memory Source" value="api/signals" />
      </div>

      <Surface title="Search memory" description="Filter the latest context by asset, timeframe, direction, or explanation.">
        <div className="grid gap-3 md:grid-cols-[1.4fr_0.6fr]">
          <input
            type="text"
            placeholder="Find similar market states…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="rounded-xl border border-white/10 bg-[#0f0f0f] px-3 py-3 text-sm text-white placeholder:text-white/30 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          <div className="rounded-xl border border-white/8 bg-white/[0.02] px-3 py-3 text-xs leading-6 text-white/55">
            Every retrieval is backed by the real signal payloads stored in the backend.
          </div>
        </div>
      </Surface>

      <div className="grid gap-4 xl:grid-cols-[1.35fr_0.85fr]">
        <Surface title="Knowledge stream" description="The freshest retrieved contexts from the live signal feed.">
          {isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <Card key={i} className="bg-white/[0.02]">
                  <div className="h-24 animate-pulse rounded-2xl bg-white/5" />
                </Card>
              ))}
            </div>
          ) : filteredSignals.length === 0 ? (
            <EmptyState title="No matching context" description="Try a broader search or refresh the retrieval stream." />
          ) : (
            <div className="space-y-3">
              {filteredSignals.map((signal: any) => (
                <Card key={signal.id} className="bg-white/[0.02]">
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div className="min-w-0">
                      <div className="text-[11px] uppercase tracking-[0.2em] text-white/35">
                        {signal.asset} · {signal.timeframe}
                      </div>
                      <div className="mt-1 text-base font-medium text-white">{signal.direction}</div>
                      <p className="mt-2 text-sm leading-6 text-white/55 text-pretty">
                        {signal.rag_context ?? signal.explanation ?? 'Sem contexto disponível'}
                      </p>
                    </div>
                    <div className="text-xs text-white/40">{formatSaoPauloDateTime(signal.timestamp)}</div>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Badge variant={signal.direction === 'LONG' ? 'success' : signal.direction === 'SHORT' ? 'danger' : 'default'}>
                      {signal.direction}
                    </Badge>
                    <Badge variant="default">{normalizeConfidence(signal.confidence ?? 0).toFixed(1)}%</Badge>
                    <Badge variant="default">{signal.regime ?? 'n/a'}</Badge>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </Surface>

        <div className="space-y-4">
          <Surface title="Semantic map" description="A light visual summary of the retrieval density.">
            <div className="aspect-square rounded-3xl border border-white/8 bg-black/40 p-4">
              <div className="flex h-full items-center justify-center rounded-2xl border border-white/8 bg-[radial-gradient(circle_at_center,rgba(34,211,238,0.12),transparent_65%)]">
                <div className="px-6 text-center">
                  <p className="text-[10px] uppercase tracking-[0.3em] text-cyan-400/60">Context density</p>
                  <p className="mt-2 text-sm leading-6 text-white/45">Live memory derived from the backend signal stream.</p>
                </div>
              </div>
            </div>
          </Surface>

          <Surface title="Index health" description="Persistence and live query state.">
            <div className="space-y-3">
              <InlineStat label="Persistence Layer" value={filteredSignals.length ? 'CONNECTED' : 'EMPTY'} tone={filteredSignals.length ? 'success' : 'default'} />
              <InlineStat label="Query Latency" value={isFetching ? 'REFRESHING' : 'LIVE'} tone="info" />
            </div>
          </Surface>
        </div>
      </div>
    </div>
  )
}
