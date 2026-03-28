'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { format } from 'date-fns'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'
import { Badge } from '@/components/ui/badge'
import { SkeletonRow } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

interface BacktestRun {
  id: string
  strategy_id: string
  asset: string
  timeframe: string
  run_at: string
  sharpe: number
  profit_factor: number
  max_drawdown: number
  win_rate: number
  expectancy: number
  total_trades: number
  equity_curve_json: { date: string; equity: number }[]
}

const MOCK_BACKTESTS: BacktestRun[] = [
  {
    id: '1',
    strategy_id: 'momentum_v1',
    asset: 'BTC/USDT',
    timeframe: '4h',
    run_at: new Date(Date.now() - 3600000).toISOString(),
    sharpe: 1.82,
    profit_factor: 2.1,
    max_drawdown: 12.4,
    win_rate: 0.58,
    expectancy: 245.5,
    total_trades: 142,
    equity_curve_json: Array.from({ length: 30 }, (_, i) => ({
      date: format(new Date(Date.now() - (29 - i) * 86400000), 'MM/dd'),
      equity: 10000 * (1 + i * 0.02 + Math.sin(i) * 0.03),
    })),
  },
  {
    id: '2',
    strategy_id: 'mean_reversion_v2',
    asset: 'ETH/USDT',
    timeframe: '1h',
    run_at: new Date(Date.now() - 7200000).toISOString(),
    sharpe: 0.72,
    profit_factor: 1.4,
    max_drawdown: 18.7,
    win_rate: 0.61,
    expectancy: 87.2,
    total_trades: 289,
    equity_curve_json: Array.from({ length: 30 }, (_, i) => ({
      date: format(new Date(Date.now() - (29 - i) * 86400000), 'MM/dd'),
      equity: 10000 * (1 + i * 0.01 + Math.cos(i * 0.5) * 0.05),
    })),
  },
  {
    id: '3',
    strategy_id: 'breakout_v1',
    asset: 'SOL/USDT',
    timeframe: '1d',
    run_at: new Date(Date.now() - 10800000).toISOString(),
    sharpe: 0.31,
    profit_factor: 1.1,
    max_drawdown: 28.3,
    win_rate: 0.42,
    expectancy: 32.1,
    total_trades: 67,
    equity_curve_json: Array.from({ length: 30 }, (_, i) => ({
      date: format(new Date(Date.now() - (29 - i) * 86400000), 'MM/dd'),
      equity: 10000 * (1 + i * 0.003 - Math.sin(i * 0.8) * 0.04),
    })),
  },
]

async function fetchBacktests(): Promise<BacktestRun[]> {
  const res = await fetch('/api/backtests')
  if (!res.ok) throw new Error('Failed to fetch backtests')
  return res.json()
}

async function runBacktest(params: { strategy_id: string; asset: string; timeframe: string }) {
  const res = await fetch('/api/backtests/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  })
  if (!res.ok) throw new Error('Failed to run backtest')
  return res.json()
}

function sharpeBadge(sharpe: number) {
  if (sharpe >= 1) return <span className="text-emerald-400 font-semibold">{sharpe.toFixed(2)}</span>
  if (sharpe >= 0.5) return <span className="text-yellow-400 font-semibold">{sharpe.toFixed(2)}</span>
  return <span className="text-red-400 font-semibold">{sharpe.toFixed(2)}</span>
}

export default function BacktestsPage() {
  const queryClient = useQueryClient()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [filterStrategy, setFilterStrategy] = useState<string>('all')
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState({ strategy_id: '', asset: 'BTC/USDT', timeframe: '4h' })

  const { data: backtests, isLoading, isError } = useQuery<BacktestRun[]>({
    queryKey: ['backtests'],
    queryFn: fetchBacktests,
    placeholderData: MOCK_BACKTESTS,
  })

  const runMutation = useMutation({
    mutationFn: runBacktest,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['backtests'] })
      setShowModal(false)
    },
  })

  const displayBacktests = backtests ?? MOCK_BACKTESTS

  const strategies = Array.from(new Set(displayBacktests.map((b) => b.strategy_id)))

  const filtered =
    filterStrategy === 'all'
      ? displayBacktests
      : displayBacktests.filter((b) => b.strategy_id === filterStrategy)

  const selected = displayBacktests.find((b) => b.id === selectedId)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Backtest Results</h1>
          <p className="text-sm text-white/50 mt-0.5">Strategy performance analysis</p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="px-4 py-2 rounded-lg text-sm font-medium bg-blue-500 hover:bg-blue-600 text-white transition-colors"
        >
          Run Backtest
        </button>
      </div>

      {isError && (
        <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-sm px-4 py-3 rounded-lg">
          Failed to fetch backtests from API — showing mock data.
        </div>
      )}

      {/* Filter */}
      <div className="flex items-center gap-3">
        <label className="text-sm text-white/50">Strategy:</label>
        <select
          value={filterStrategy}
          onChange={(e) => setFilterStrategy(e.target.value)}
          className="bg-[#111] border border-white/10 text-white text-sm rounded-lg px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-500"
        >
          <option value="all">All Strategies</option>
          {strategies.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </div>

      {/* Table */}
      <div className="bg-[#111111] border border-white/10 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-white/[0.02]">
                <th className="px-4 py-3 text-left text-xs font-medium text-white/40 uppercase tracking-wider">Strategy</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-white/40 uppercase tracking-wider">Asset</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-white/40 uppercase tracking-wider">TF</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-white/40 uppercase tracking-wider">Sharpe</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-white/40 uppercase tracking-wider">PF</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-white/40 uppercase tracking-wider">Max DD</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-white/40 uppercase tracking-wider">Win Rate</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-white/40 uppercase tracking-wider">Expectancy</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-white/40 uppercase tracking-wider">Trades</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-white/40 uppercase tracking-wider">Date</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                Array.from({ length: 3 }).map((_, i) => <SkeletonRow key={i} />)
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-4 py-12 text-center text-white/30">
                    <div className="flex flex-col items-center gap-2">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-8 h-8 text-white/20">
                        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
                      </svg>
                      <span>No backtest results found</span>
                    </div>
                  </td>
                </tr>
              ) : (
                filtered.map((bt) => (
                  <tr
                    key={bt.id}
                    onClick={() => setSelectedId(selectedId === bt.id ? null : bt.id)}
                    className={cn(
                      'border-b border-white/5 hover:bg-white/[0.02] transition-colors cursor-pointer',
                      selectedId === bt.id && 'bg-blue-500/5'
                    )}
                  >
                    <td className="px-4 py-3 font-medium text-white">{bt.strategy_id}</td>
                    <td className="px-4 py-3 text-white/70">{bt.asset}</td>
                    <td className="px-4 py-3"><Badge variant="default">{bt.timeframe}</Badge></td>
                    <td className="px-4 py-3 text-right tabular-nums">{sharpeBadge(bt.sharpe)}</td>
                    <td className="px-4 py-3 text-right text-white/70 tabular-nums">{bt.profit_factor.toFixed(2)}</td>
                    <td className="px-4 py-3 text-right text-red-400/80 tabular-nums">{bt.max_drawdown.toFixed(1)}%</td>
                    <td className="px-4 py-3 text-right text-white/70 tabular-nums">{(bt.win_rate * 100).toFixed(1)}%</td>
                    <td className="px-4 py-3 text-right text-white/70 tabular-nums">{bt.expectancy.toFixed(1)}</td>
                    <td className="px-4 py-3 text-right text-white/70 tabular-nums">{bt.total_trades}</td>
                    <td className="px-4 py-3 text-white/40 text-xs">{format(new Date(bt.run_at), 'dd/MM HH:mm')}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Equity Curve Detail Panel */}
      {selected && (
        <div className="bg-[#111111] border border-white/10 rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-white">
              Equity Curve — {selected.strategy_id} / {selected.asset}
            </h3>
            <button
              onClick={() => setSelectedId(null)}
              className="text-white/40 hover:text-white/70 transition-colors"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
                <path strokeLinecap="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={selected.equity_curve_json}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis
                  dataKey="date"
                  tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v) => `$${(v / 1000).toFixed(1)}k`}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#1a1a1a',
                    border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: '8px',
                    color: '#ededed',
                    fontSize: 12,
                  }}
                  formatter={(value: number) => [`$${value.toFixed(2)}`, 'Equity']}
                />
                <Line
                  type="monotone"
                  dataKey="equity"
                  stroke="#3b82f6"
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4, fill: '#3b82f6' }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Run Backtest Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-[#111111] border border-white/10 rounded-xl p-6 w-full max-w-md space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-white">Run Backtest</h2>
              <button
                onClick={() => setShowModal(false)}
                className="text-white/40 hover:text-white/70 transition-colors"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
                  <path strokeLinecap="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-xs text-white/50 block mb-1">Strategy ID</label>
                <input
                  type="text"
                  value={form.strategy_id}
                  onChange={(e) => setForm({ ...form, strategy_id: e.target.value })}
                  placeholder="e.g. momentum_v1"
                  className="w-full bg-black/30 border border-white/10 text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-blue-500 placeholder:text-white/20"
                />
              </div>
              <div>
                <label className="text-xs text-white/50 block mb-1">Asset</label>
                <select
                  value={form.asset}
                  onChange={(e) => setForm({ ...form, asset: e.target.value })}
                  className="w-full bg-black/30 border border-white/10 text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-blue-500"
                >
                  {['BTC/USDT', 'ETH/USDT', 'BNB/USDT', 'SOL/USDT'].map((a) => (
                    <option key={a} value={a}>{a}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-white/50 block mb-1">Timeframe</label>
                <select
                  value={form.timeframe}
                  onChange={(e) => setForm({ ...form, timeframe: e.target.value })}
                  className="w-full bg-black/30 border border-white/10 text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-blue-500"
                >
                  {['15m', '1h', '4h', '1d'].map((tf) => (
                    <option key={tf} value={tf}>{tf}</option>
                  ))}
                </select>
              </div>
            </div>

            {runMutation.isError && (
              <p className="text-red-400 text-xs">Failed to run backtest. Please try again.</p>
            )}

            <div className="flex justify-end gap-3 pt-2">
              <button
                onClick={() => setShowModal(false)}
                className="px-4 py-2 text-sm text-white/50 hover:text-white transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => runMutation.mutate(form)}
                disabled={runMutation.isPending || !form.strategy_id}
                className={cn(
                  'px-4 py-2 rounded-lg text-sm font-medium transition-all',
                  runMutation.isPending || !form.strategy_id
                    ? 'bg-blue-500/30 text-blue-400/60 cursor-not-allowed'
                    : 'bg-blue-500 hover:bg-blue-600 text-white'
                )}
              >
                {runMutation.isPending ? 'Running…' : 'Run'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
