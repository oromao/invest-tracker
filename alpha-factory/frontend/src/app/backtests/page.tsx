'use client'

import { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { EmptyState, InlineStat, MetricCard, PageHeader, Surface, StatusPill } from '@/components/product-ui'
import { SkeletonCard } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { formatSaoPauloDateTime } from '@/lib/time'
import { fetchBacktests, runBacktest } from '@/utils/api'

interface BacktestRun {
  id: string | number
  strategy_id: string | number
  asset: string
  timeframe: string
  run_at: string
  sharpe: number
  profit_factor: number
  max_drawdown: number
  win_rate: number
  expectancy: number
  total_trades: number
  equity_curve?: { date: string; equity: number }[]
  equity_curve_json: { date: string; equity: number }[]
}

function sharpeTone(sharpe: number) {
  if (sharpe >= 1) return 'success'
  if (sharpe >= 0.5) return 'warning'
  return 'danger'
}

export default function BacktestsPage() {
  const queryClient = useQueryClient()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [filterStrategy, setFilterStrategy] = useState<string>('all')
  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState<'run_at' | 'sharpe' | 'profit_factor' | 'max_drawdown' | 'win_rate' | 'expectancy' | 'total_trades' | 'asset' | 'strategy_id'>('run_at')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState({ strategy_id: 'momentum_v1', asset: 'BTC/USDT', timeframe: '4h' })

  const { data: backtests, isLoading, isError } = useQuery<BacktestRun[]>({
    queryKey: ['backtests'],
    queryFn: fetchBacktests,
  })

  const runMutation = useMutation({
    mutationFn: runBacktest,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['backtests'] })
      setShowModal(false)
    },
  })

  const displayBacktests = useMemo(
    () =>
      (backtests ?? []).map((bt) => ({
        ...bt,
        strategy_id: bt.strategy_id ?? 'unknown',
        equity_curve_json: bt.equity_curve_json ?? bt.equity_curve ?? [],
      })),
    [backtests]
  )

  const strategies = useMemo(() => Array.from(new Set(displayBacktests.map((b) => String(b.strategy_id)))), [displayBacktests])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const list = displayBacktests.filter((b) => {
      const matchesStrategy = filterStrategy === 'all' || String(b.strategy_id) === filterStrategy
      const matchesSearch =
        !q ||
        String(b.strategy_id).toLowerCase().includes(q) ||
        b.asset.toLowerCase().includes(q) ||
        b.timeframe.toLowerCase().includes(q)
      return matchesStrategy && matchesSearch
    })
    const dir = sortDir === 'asc' ? 1 : -1
    return list.sort((a, b) => {
      switch (sortKey) {
        case 'sharpe':
          return (a.sharpe - b.sharpe) * dir
        case 'profit_factor':
          return (a.profit_factor - b.profit_factor) * dir
        case 'max_drawdown':
          return (a.max_drawdown - b.max_drawdown) * dir
        case 'win_rate':
          return (a.win_rate - b.win_rate) * dir
        case 'expectancy':
          return (a.expectancy - b.expectancy) * dir
        case 'total_trades':
          return (a.total_trades - b.total_trades) * dir
        case 'asset':
          return a.asset.localeCompare(b.asset) * dir
        case 'strategy_id':
          return String(a.strategy_id).localeCompare(String(b.strategy_id)) * dir
        case 'run_at':
        default:
          return (new Date(a.run_at).getTime() - new Date(b.run_at).getTime()) * dir
      }
    })
  }, [displayBacktests, filterStrategy, search, sortKey, sortDir])

  const toggleSort = (key: typeof sortKey) => {
    if (sortKey === key) {
      setSortDir((current) => (current === 'asc' ? 'desc' : 'asc'))
      return
    }
    setSortKey(key)
    setSortDir('desc')
  }

  const selected = displayBacktests.find((b) => String(b.id) === selectedId)
  const latest = filtered[0]
  const sortOptions = [
    ['strategy_id', 'Strategy'],
    ['asset', 'Asset'],
    ['run_at', 'Date'],
    ['sharpe', 'Sharpe'],
    ['profit_factor', 'PF'],
    ['max_drawdown', 'Max DD'],
    ['win_rate', 'Win Rate'],
    ['expectancy', 'Expectancy'],
    ['total_trades', 'Trades'],
  ] as const

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Backtests"
        title="Performance evidence"
        subtitle="Each result includes the key trading metrics and a drill-down into the equity curve for the selected run."
        action={
          <button
            onClick={() => setShowModal(true)}
            className="inline-flex items-center justify-center rounded-full bg-blue-500 px-4 py-2 text-sm font-medium text-white hover:bg-blue-600"
          >
            Run Backtest
          </button>
        }
        status={<StatusPill tone={latest ? sharpeTone(latest.sharpe) : 'default'}>{latest ? `Best Sharpe ${latest.sharpe.toFixed(2)}` : 'No runs yet'}</StatusPill>}
      />

      {isError && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          Failed to fetch backtests from API — showing the current empty or partial state.
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <MetricCard label="Runs" value={filtered.length} tone="info" />
        <MetricCard label="Best Sharpe" value={latest ? latest.sharpe.toFixed(2) : 'n/a'} tone={latest ? sharpeTone(latest.sharpe) : 'default'} />
        <MetricCard label="Best PF" value={latest ? latest.profit_factor.toFixed(2) : 'n/a'} tone="success" />
        <MetricCard label="Best Trades" value={latest ? latest.total_trades : 0} />
      </div>

      <Surface title="Filters" description="Narrow by strategy or free text.">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-[0.9fr_1.2fr]">
          <select
            value={filterStrategy}
            onChange={(e) => setFilterStrategy(e.target.value)}
            className="rounded-xl border border-white/10 bg-[#0f0f0f] px-3 py-3 text-sm text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            <option value="all">All strategies</option>
            {strategies.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search strategy, asset or timeframe…"
            className="rounded-xl border border-white/10 bg-[#0f0f0f] px-3 py-3 text-sm text-white placeholder:text-white/30 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
      </Surface>

      <Surface title="Backtest results" description="High-signal summary cards with optional deeper drill-down.">
        <div className="mb-4 flex flex-wrap gap-2 text-[11px] text-white/35">
          {sortOptions.map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => toggleSort(key)}
              className="rounded-full border border-white/10 px-3 py-2 uppercase tracking-[0.18em] transition-colors hover:border-white/20 hover:text-white"
            >
              {label}
              {sortKey === key ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''}
            </button>
          ))}
        </div>

        {isLoading ? (
          <div className="grid gap-3 lg:grid-cols-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <SkeletonCard key={i} />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState title="No backtest results found" description="Run a backtest to populate the performance board." />
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {filtered.map((bt) => (
              <Card
                key={String(bt.id)}
                onClick={() => setSelectedId(selectedId === String(bt.id) ? null : String(bt.id))}
                className={cn(
                  'cursor-pointer bg-white/[0.02] transition-colors',
                  selectedId === String(bt.id) && 'ring-1 ring-blue-500/30'
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-base font-medium text-white">{bt.strategy_id}</div>
                    <div className="mt-1 text-sm text-white/50">{bt.asset} · {bt.timeframe}</div>
                  </div>
                  <Badge variant="default">{formatSaoPauloDateTime(bt.run_at)}</Badge>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-4">
                  <InlineStat label="Sharpe" value={bt.sharpe.toFixed(2)} tone={sharpeTone(bt.sharpe)} />
                  <InlineStat label="PF" value={bt.profit_factor.toFixed(2)} tone="success" />
                  <InlineStat label="Max DD" value={`${bt.max_drawdown.toFixed(1)}%`} tone="danger" />
                  <InlineStat label="Trades" value={bt.total_trades} />
                </div>
                <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-4">
                  <InlineStat label="Win Rate" value={`${(bt.win_rate * 100).toFixed(1)}%`} />
                  <InlineStat label="Expectancy" value={bt.expectancy.toFixed(1)} />
                  <InlineStat label="Run Date" value={formatSaoPauloDateTime(bt.run_at)} />
                  <InlineStat label="Leader" value={bt.strategy_id} />
                </div>
              </Card>
            ))}
          </div>
        )}
      </Surface>

      {selected && (
        <Surface title="Equity curve" description={`${selected.strategy_id} · ${selected.asset}`}>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={selected.equity_curve_json || []}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
                <XAxis dataKey="date" tick={{ fill: 'rgba(255,255,255,0.45)', fontSize: 11 }} minTickGap={32} />
                <YAxis tick={{ fill: 'rgba(255,255,255,0.45)', fontSize: 11 }} width={42} />
                <Tooltip
                  contentStyle={{ background: '#111', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12, color: '#fff' }}
                />
                <Line type="monotone" dataKey="equity" stroke="#60a5fa" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Surface>
      )}

      {showModal && (
        <Surface title="Run new backtest" description="Launch a new test with real runtime inputs.">
          <div className="grid gap-3 md:grid-cols-3">
            <input
              value={form.strategy_id}
              onChange={(e) => setForm((current) => ({ ...current, strategy_id: e.target.value }))}
              className="rounded-xl border border-white/10 bg-[#0f0f0f] px-3 py-3 text-sm text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
            <input
              value={form.asset}
              onChange={(e) => setForm((current) => ({ ...current, asset: e.target.value }))}
              className="rounded-xl border border-white/10 bg-[#0f0f0f] px-3 py-3 text-sm text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
            <input
              value={form.timeframe}
              onChange={(e) => setForm((current) => ({ ...current, timeframe: e.target.value }))}
              className="rounded-xl border border-white/10 bg-[#0f0f0f] px-3 py-3 text-sm text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <div className="mt-4 flex gap-2">
            <button
              onClick={() => runMutation.mutate(form)}
              className="rounded-full bg-blue-500 px-4 py-2 text-sm font-medium text-white hover:bg-blue-600"
            >
              {runMutation.isPending ? 'Running…' : 'Run'}
            </button>
            <button
              onClick={() => setShowModal(false)}
              className="rounded-full border border-white/10 px-4 py-2 text-sm font-medium text-white hover:bg-white/5"
            >
              Cancel
            </button>
          </div>
        </Surface>
      )}
    </div>
  )
}
