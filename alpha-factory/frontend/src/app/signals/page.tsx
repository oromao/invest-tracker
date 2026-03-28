'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { format } from 'date-fns'
import { Card, CardTitle, CardValue } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { SkeletonCard, SkeletonRow } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

interface Signal {
  id: string
  asset: string
  direction: 'LONG' | 'SHORT' | 'NO_TRADE'
  confidence: number
  entry_price: number
  tp1: number
  tp2: number
  sl: number
  regime: string
  explanation: string
  timestamp: string
}

const MOCK_SIGNALS: Signal[] = [
  {
    id: '1',
    asset: 'BTC/USDT',
    direction: 'LONG',
    confidence: 82,
    entry_price: 67450.0,
    tp1: 69000.0,
    tp2: 71500.0,
    sl: 65800.0,
    regime: 'trend_bull',
    explanation: 'Strong momentum with volume confirmation',
    timestamp: new Date().toISOString(),
  },
  {
    id: '2',
    asset: 'ETH/USDT',
    direction: 'SHORT',
    confidence: 65,
    entry_price: 3520.0,
    tp1: 3400.0,
    tp2: 3250.0,
    sl: 3650.0,
    regime: 'trend_bear',
    explanation: 'Bearish divergence on 4H',
    timestamp: new Date().toISOString(),
  },
  {
    id: '3',
    asset: 'BNB/USDT',
    direction: 'NO_TRADE',
    confidence: 35,
    entry_price: 415.0,
    tp1: 0,
    tp2: 0,
    sl: 0,
    regime: 'range',
    explanation: 'Choppy market, no clear edge',
    timestamp: new Date().toISOString(),
  },
  {
    id: '4',
    asset: 'SOL/USDT',
    direction: 'LONG',
    confidence: 74,
    entry_price: 148.5,
    tp1: 155.0,
    tp2: 162.0,
    sl: 142.0,
    regime: 'trend_bull',
    explanation: 'Breakout from consolidation zone',
    timestamp: new Date().toISOString(),
  },
]

async function fetchSignals(): Promise<Signal[]> {
  const res = await fetch('/api/signals')
  if (!res.ok) throw new Error('Failed to fetch signals')
  return res.json()
}

async function generateSignals(): Promise<void> {
  const res = await fetch('/api/signals/generate', { method: 'POST' })
  if (!res.ok) throw new Error('Failed to generate signals')
}

function directionBadge(direction: Signal['direction']) {
  if (direction === 'LONG') return <Badge variant="success">LONG</Badge>
  if (direction === 'SHORT') return <Badge variant="danger">SHORT</Badge>
  return <Badge variant="default">NO TRADE</Badge>
}

function ConfidenceBar({ value }: { value: number }) {
  const color =
    value >= 70 ? 'bg-emerald-500' : value >= 40 ? 'bg-yellow-500' : 'bg-red-500'
  return (
    <div className="flex items-center gap-2">
      <div className="w-16 h-1.5 bg-white/10 rounded-full overflow-hidden">
        <div className={cn('h-full rounded-full', color)} style={{ width: `${value}%` }} />
      </div>
      <span className="text-xs text-white/70">{value}%</span>
    </div>
  )
}

export default function SignalsPage() {
  const queryClient = useQueryClient()

  const { data: signals, isLoading, isError } = useQuery<Signal[]>({
    queryKey: ['signals'],
    queryFn: fetchSignals,
    placeholderData: MOCK_SIGNALS,
    refetchInterval: 30_000,
  })

  const generateMutation = useMutation({
    mutationFn: generateSignals,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['signals'] }),
  })

  const displaySignals = signals ?? MOCK_SIGNALS

  const total = displaySignals.length
  const longs = displaySignals.filter((s) => s.direction === 'LONG').length
  const shorts = displaySignals.filter((s) => s.direction === 'SHORT').length
  const noTrades = displaySignals.filter((s) => s.direction === 'NO_TRADE').length

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Alpha Factory</h1>
          <p className="text-sm text-white/50 mt-0.5">Autonomous Signal Engine</p>
        </div>
        <button
          onClick={() => generateMutation.mutate()}
          disabled={generateMutation.isPending}
          className={cn(
            'px-4 py-2 rounded-lg text-sm font-medium transition-all',
            generateMutation.isPending
              ? 'bg-blue-500/30 text-blue-400/60 cursor-not-allowed'
              : 'bg-blue-500 hover:bg-blue-600 text-white'
          )}
        >
          {generateMutation.isPending ? (
            <span className="flex items-center gap-2">
              <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
              </svg>
              Generating…
            </span>
          ) : (
            'Generate Signals'
          )}
        </button>
      </div>

      {/* Error banner */}
      {isError && (
        <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-sm px-4 py-3 rounded-lg">
          Failed to fetch signals from API — showing mock data.
        </div>
      )}

      {/* Stat Cards */}
      <div className="grid grid-cols-4 gap-4">
        {isLoading ? (
          Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)
        ) : (
          <>
            <Card>
              <CardTitle>Total Today</CardTitle>
              <CardValue>{total}</CardValue>
            </Card>
            <Card>
              <CardTitle>Long</CardTitle>
              <CardValue className="text-emerald-400">{longs}</CardValue>
            </Card>
            <Card>
              <CardTitle>Short</CardTitle>
              <CardValue className="text-red-400">{shorts}</CardValue>
            </Card>
            <Card>
              <CardTitle>No Trade</CardTitle>
              <CardValue className="text-white/50">{noTrades}</CardValue>
            </Card>
          </>
        )}
      </div>

      {/* Signals Table */}
      <div className="bg-[#111111] border border-white/10 rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-white/8">
          <h2 className="text-sm font-semibold text-white">Active Signals</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-white/[0.02]">
                <th className="px-4 py-3 text-left text-xs font-medium text-white/40 uppercase tracking-wider">Asset</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-white/40 uppercase tracking-wider">Direction</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-white/40 uppercase tracking-wider">Confidence</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-white/40 uppercase tracking-wider">Regime</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-white/40 uppercase tracking-wider">Entry</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-white/40 uppercase tracking-wider">TP1</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-white/40 uppercase tracking-wider">TP2</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-white/40 uppercase tracking-wider">SL</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-white/40 uppercase tracking-wider">Time</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                Array.from({ length: 4 }).map((_, i) => <SkeletonRow key={i} />)
              ) : displaySignals.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-12 text-center text-white/30">
                    <div className="flex flex-col items-center gap-2">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-8 h-8 text-white/20">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                      </svg>
                      <span>No signals yet — click Generate Signals</span>
                    </div>
                  </td>
                </tr>
              ) : (
                displaySignals.map((signal) => (
                  <tr key={signal.id} className="border-b border-white/5 hover:bg-white/[0.02] transition-colors">
                    <td className="px-4 py-3 font-medium text-white">{signal.asset}</td>
                    <td className="px-4 py-3">{directionBadge(signal.direction)}</td>
                    <td className="px-4 py-3"><ConfidenceBar value={signal.confidence} /></td>
                    <td className="px-4 py-3 text-white/60 text-xs">{signal.regime}</td>
                    <td className="px-4 py-3 text-right text-white/80 tabular-nums">{signal.entry_price.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
                    <td className="px-4 py-3 text-right text-emerald-400/80 tabular-nums">{signal.tp1 > 0 ? signal.tp1.toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : '—'}</td>
                    <td className="px-4 py-3 text-right text-emerald-400/60 tabular-nums">{signal.tp2 > 0 ? signal.tp2.toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : '—'}</td>
                    <td className="px-4 py-3 text-right text-red-400/80 tabular-nums">{signal.sl > 0 ? signal.sl.toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : '—'}</td>
                    <td className="px-4 py-3 text-white/40 text-xs">
                      {format(new Date(signal.timestamp), 'HH:mm:ss')}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
