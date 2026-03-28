'use client'

import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
const PCT = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const NUM = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 3, maximumFractionDigits: 3 })

type StrategyType = 'SMA_CROSSOVER' | 'EMA_CROSSOVER' | 'RSI' | 'MACD' | 'BOLLINGER'

interface StrategyParams {
  type: StrategyType
  fastPeriod?: number
  slowPeriod?: number
  rsiPeriod?: number
  rsiOversold?: number
  rsiOverbought?: number
  macdFast?: number
  macdSlow?: number
  macdSignal?: number
  bbPeriod?: number
  bbStdDev?: number
}

interface BacktestTrade {
  entryDate: string
  exitDate: string
  entryPrice: number
  exitPrice: number
  pnlPercent: number
  exitReason: string
}

interface EquityPoint {
  date: string
  equity: number
}

interface BacktestResult {
  totalReturn: number
  annualizedReturn: number
  sharpeRatio: number
  maxDrawdown: number
  winRate: number
  profitFactor: number | null
  avgWin: number
  avgLoss: number
  finalCapital: number
  totalTrades: number
  equityCurve: EquityPoint[]
  trades: BacktestTrade[]
}

interface HistoryResult {
  ok: boolean
  ticker: string
  candles: number
  from: string
  to: string
  error?: string
}

const inputClass =
  'w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white placeholder-white/30 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50 transition-all text-sm'

const STRATEGIES: { value: StrategyType; label: string }[] = [
  { value: 'SMA_CROSSOVER', label: 'SMA Crossover' },
  { value: 'EMA_CROSSOVER', label: 'EMA Crossover' },
  { value: 'RSI', label: 'RSI' },
  { value: 'MACD', label: 'MACD' },
  { value: 'BOLLINGER', label: 'Bollinger Bands' },
]

const DAYS_OPTIONS = [
  { value: 30, label: '30 dias' },
  { value: 90, label: '90 dias' },
  { value: 180, label: '180 dias' },
  { value: 365, label: '1 ano' },
]

function MetricCard({
  label,
  value,
  good,
  suffix = '',
}: {
  label: string
  value: string | number | null
  good?: boolean
  suffix?: string
}) {
  const colorClass =
    good === undefined
      ? 'text-white'
      : good
      ? 'text-green-400'
      : 'text-red-400'

  return (
    <Card className="text-center">
      <p className="text-xs text-white/50 mb-1">{label}</p>
      <p className={`text-xl font-bold ${colorClass}`}>
        {value === null ? '—' : `${value}${suffix}`}
      </p>
    </Card>
  )
}

function StrategyParamsFields({
  strategy,
  params,
  onChange,
}: {
  strategy: StrategyType
  params: Partial<StrategyParams>
  onChange: (key: keyof StrategyParams, value: number) => void
}) {
  if (strategy === 'SMA_CROSSOVER' || strategy === 'EMA_CROSSOVER') {
    return (
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs text-white/60 mb-1">Período Rápido</label>
          <input
            type="number"
            value={params.fastPeriod ?? 9}
            onChange={(e) => onChange('fastPeriod', parseInt(e.target.value))}
            min={2}
            max={200}
            className={inputClass}
          />
        </div>
        <div>
          <label className="block text-xs text-white/60 mb-1">Período Lento</label>
          <input
            type="number"
            value={params.slowPeriod ?? 21}
            onChange={(e) => onChange('slowPeriod', parseInt(e.target.value))}
            min={2}
            max={500}
            className={inputClass}
          />
        </div>
      </div>
    )
  }

  if (strategy === 'RSI') {
    return (
      <div className="grid grid-cols-3 gap-4">
        <div>
          <label className="block text-xs text-white/60 mb-1">Período RSI</label>
          <input
            type="number"
            value={params.rsiPeriod ?? 14}
            onChange={(e) => onChange('rsiPeriod', parseInt(e.target.value))}
            min={2}
            max={100}
            className={inputClass}
          />
        </div>
        <div>
          <label className="block text-xs text-white/60 mb-1">Sobrevendido</label>
          <input
            type="number"
            value={params.rsiOversold ?? 30}
            onChange={(e) => onChange('rsiOversold', parseFloat(e.target.value))}
            min={1}
            max={49}
            className={inputClass}
          />
        </div>
        <div>
          <label className="block text-xs text-white/60 mb-1">Sobrecomprado</label>
          <input
            type="number"
            value={params.rsiOverbought ?? 70}
            onChange={(e) => onChange('rsiOverbought', parseFloat(e.target.value))}
            min={51}
            max={99}
            className={inputClass}
          />
        </div>
      </div>
    )
  }

  if (strategy === 'MACD') {
    return (
      <div className="grid grid-cols-3 gap-4">
        <div>
          <label className="block text-xs text-white/60 mb-1">MACD Rápido</label>
          <input
            type="number"
            value={params.macdFast ?? 12}
            onChange={(e) => onChange('macdFast', parseInt(e.target.value))}
            min={2}
            max={100}
            className={inputClass}
          />
        </div>
        <div>
          <label className="block text-xs text-white/60 mb-1">MACD Lento</label>
          <input
            type="number"
            value={params.macdSlow ?? 26}
            onChange={(e) => onChange('macdSlow', parseInt(e.target.value))}
            min={2}
            max={200}
            className={inputClass}
          />
        </div>
        <div>
          <label className="block text-xs text-white/60 mb-1">Sinal</label>
          <input
            type="number"
            value={params.macdSignal ?? 9}
            onChange={(e) => onChange('macdSignal', parseInt(e.target.value))}
            min={2}
            max={50}
            className={inputClass}
          />
        </div>
      </div>
    )
  }

  if (strategy === 'BOLLINGER') {
    return (
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs text-white/60 mb-1">Período BB</label>
          <input
            type="number"
            value={params.bbPeriod ?? 20}
            onChange={(e) => onChange('bbPeriod', parseInt(e.target.value))}
            min={2}
            max={200}
            className={inputClass}
          />
        </div>
        <div>
          <label className="block text-xs text-white/60 mb-1">Desvio Padrão</label>
          <input
            type="number"
            value={params.bbStdDev ?? 2}
            onChange={(e) => onChange('bbStdDev', parseFloat(e.target.value))}
            min={0.5}
            max={5}
            step={0.1}
            className={inputClass}
          />
        </div>
      </div>
    )
  }

  return null
}

export default function BacktestPage() {
  // Step 1: History
  const [ticker, setTicker] = useState('')
  const [days, setDays] = useState(365)
  const [historyLoaded, setHistoryLoaded] = useState(false)
  const [historyInfo, setHistoryInfo] = useState<HistoryResult | null>(null)

  // Step 2: Strategy
  const [strategy, setStrategy] = useState<StrategyType>('SMA_CROSSOVER')
  const [strategyParams, setStrategyParams] = useState<Partial<StrategyParams>>({})
  const [initialCapital, setInitialCapital] = useState('10000')
  const [stopLoss, setStopLoss] = useState('')
  const [takeProfit, setTakeProfit] = useState('')
  const [feePercent, setFeePercent] = useState('0.1')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')

  const [result, setResult] = useState<BacktestResult | null>(null)
  const [runError, setRunError] = useState<string | null>(null)

  const loadHistory = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/backtest/history', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticker: ticker.toUpperCase(), days }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Erro ao carregar histórico')
      return data as HistoryResult
    },
    onSuccess: (data) => {
      setHistoryLoaded(true)
      setHistoryInfo(data)
      setRunError(null)
    },
    onError: (err: Error) => {
      setRunError(err.message)
    },
  })

  const runBacktest = useMutation({
    mutationFn: async () => {
      const body: Record<string, unknown> = {
        ticker: ticker.toUpperCase(),
        strategy: { type: strategy, ...strategyParams },
        initialCapital: parseFloat(initialCapital),
        feePercent: parseFloat(feePercent) || 0.1,
      }
      if (stopLoss) body.stopLoss = parseFloat(stopLoss)
      if (takeProfit) body.takeProfit = parseFloat(takeProfit)
      if (startDate) body.startDate = new Date(startDate).toISOString()
      if (endDate) body.endDate = new Date(endDate).toISOString()

      const res = await fetch('/api/backtest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Erro ao executar backtest')
      return data as BacktestResult
    },
    onSuccess: (data) => {
      setResult(data)
      setRunError(null)
    },
    onError: (err: Error) => {
      setRunError(err.message)
    },
  })

  function updateParam(key: keyof StrategyParams, value: number) {
    setStrategyParams((prev) => ({ ...prev, [key]: value }))
  }

  const equityData = result?.equityCurve.map((p) => ({
    date: p.date ? format(new Date(p.date), 'dd/MM/yy', { locale: ptBR }) : '',
    equity: p.equity,
  })) ?? []

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Backtest</h1>
        <p className="text-white/50 text-sm mt-1">Simule estratégias de trading em dados históricos</p>
      </div>

      {/* Step 1: Load History */}
      <Card className="p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-7 h-7 rounded-full bg-blue-600 flex items-center justify-center text-xs font-bold text-white flex-shrink-0">
            1
          </div>
          <h2 className="font-semibold text-white">Carregar Histórico</h2>
          {historyLoaded && (
            <Badge variant="success">Carregado</Badge>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs text-white/60 mb-1">Ticker (cripto)</label>
            <input
              type="text"
              value={ticker}
              onChange={(e) => setTicker(e.target.value.toUpperCase())}
              placeholder="BTC, ETH, SOL..."
              className={inputClass}
            />
          </div>
          <div>
            <label className="block text-xs text-white/60 mb-1">Período de histórico</label>
            <select
              value={days}
              onChange={(e) => setDays(parseInt(e.target.value))}
              className={inputClass}
            >
              {DAYS_OPTIONS.map((d) => (
                <option key={d.value} value={d.value}>
                  {d.label}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-end">
            <button
              onClick={() => loadHistory.mutate()}
              disabled={!ticker.trim() || loadHistory.isPending}
              className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-600/50 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors"
            >
              {loadHistory.isPending ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Carregando...
                </span>
              ) : (
                'Carregar Histórico'
              )}
            </button>
          </div>
        </div>

        {historyInfo && (
          <div className="mt-4 bg-green-500/10 border border-green-500/20 rounded-lg px-4 py-3 text-sm">
            <p className="text-green-400 font-medium">
              {historyInfo.candles} candles carregados para {historyInfo.ticker}
            </p>
            <p className="text-white/50 text-xs mt-0.5">
              {format(new Date(historyInfo.from), 'dd/MM/yyyy', { locale: ptBR })} —{' '}
              {format(new Date(historyInfo.to), 'dd/MM/yyyy', { locale: ptBR })}
            </p>
          </div>
        )}
      </Card>

      {/* Step 2: Configure & Run */}
      <Card className="p-6">
        <div className="flex items-center gap-3 mb-4">
          <div
            className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0 ${historyLoaded ? 'bg-blue-600' : 'bg-white/10'}`}
          >
            2
          </div>
          <h2 className={`font-semibold ${historyLoaded ? 'text-white' : 'text-white/40'}`}>
            Configurar Estratégia
          </h2>
        </div>

        <div
          className={`space-y-5 ${!historyLoaded ? 'opacity-40 pointer-events-none' : ''}`}
        >
          {/* Strategy type */}
          <div>
            <label className="block text-xs text-white/60 mb-1">Estratégia</label>
            <select
              value={strategy}
              onChange={(e) => {
                setStrategy(e.target.value as StrategyType)
                setStrategyParams({})
              }}
              className={inputClass}
            >
              {STRATEGIES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>

          {/* Strategy params */}
          <StrategyParamsFields
            strategy={strategy}
            params={strategyParams}
            onChange={updateParam}
          />

          {/* Capital and fees */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div>
              <label className="block text-xs text-white/60 mb-1">Capital Inicial (R$)</label>
              <input
                type="number"
                value={initialCapital}
                onChange={(e) => setInitialCapital(e.target.value)}
                min={1}
                className={inputClass}
              />
            </div>
            <div>
              <label className="block text-xs text-white/60 mb-1">Comissão (%)</label>
              <input
                type="number"
                value={feePercent}
                onChange={(e) => setFeePercent(e.target.value)}
                min={0}
                max={5}
                step={0.01}
                className={inputClass}
              />
            </div>
            <div>
              <label className="block text-xs text-white/60 mb-1">Stop Loss (%)</label>
              <input
                type="number"
                value={stopLoss}
                onChange={(e) => setStopLoss(e.target.value)}
                placeholder="opcional"
                min={0.1}
                max={99}
                step={0.1}
                className={inputClass}
              />
            </div>
            <div>
              <label className="block text-xs text-white/60 mb-1">Take Profit (%)</label>
              <input
                type="number"
                value={takeProfit}
                onChange={(e) => setTakeProfit(e.target.value)}
                placeholder="opcional"
                min={0.1}
                step={0.1}
                className={inputClass}
              />
            </div>
          </div>

          {/* Date range */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-white/60 mb-1">Data Início</label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className={inputClass}
              />
            </div>
            <div>
              <label className="block text-xs text-white/60 mb-1">Data Fim</label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className={inputClass}
              />
            </div>
          </div>

          <button
            onClick={() => runBacktest.mutate()}
            disabled={runBacktest.isPending}
            className="w-full sm:w-auto px-8 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-600/50 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors text-sm"
          >
            {runBacktest.isPending ? (
              <span className="flex items-center gap-2">
                <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Executando...
              </span>
            ) : (
              'Executar Backtest'
            )}
          </button>
        </div>
      </Card>

      {/* Errors */}
      {runError && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3">
          <p className="text-red-400 text-sm">{runError}</p>
        </div>
      )}

      {/* Loading skeleton */}
      {runBacktest.isPending && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-20 rounded-xl" />
            ))}
          </div>
          <Skeleton className="h-64 rounded-xl" />
        </div>
      )}

      {/* Results */}
      {result && !runBacktest.isPending && (
        <div className="space-y-6">
          <h2 className="text-lg font-semibold text-white flex items-center gap-2">
            <svg className="w-5 h-5 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
            Resultados
          </h2>

          {/* Metrics */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
            <MetricCard
              label="Retorno Total"
              value={`${result.totalReturn >= 0 ? '+' : ''}${PCT.format(result.totalReturn)}`}
              good={result.totalReturn >= 0}
              suffix="%"
            />
            <MetricCard
              label="Retorno Anual"
              value={`${result.annualizedReturn >= 0 ? '+' : ''}${PCT.format(result.annualizedReturn)}`}
              good={result.annualizedReturn >= 0}
              suffix="%"
            />
            <MetricCard
              label="Sharpe Ratio"
              value={NUM.format(result.sharpeRatio)}
              good={result.sharpeRatio > 1}
            />
            <MetricCard
              label="Max Drawdown"
              value={`-${PCT.format(result.maxDrawdown)}`}
              good={result.maxDrawdown < 20}
              suffix="%"
            />
            <MetricCard
              label="Win Rate"
              value={PCT.format(result.winRate)}
              good={result.winRate >= 50}
              suffix="%"
            />
            <MetricCard
              label="Profit Factor"
              value={result.profitFactor !== null ? NUM.format(result.profitFactor) : null}
              good={result.profitFactor !== null && result.profitFactor > 1}
            />
          </div>

          {/* Additional metrics */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <Card className="text-center">
              <p className="text-xs text-white/50 mb-1">Capital Final</p>
              <p className="text-lg font-bold text-white">{BRL.format(result.finalCapital)}</p>
            </Card>
            <Card className="text-center">
              <p className="text-xs text-white/50 mb-1">Total de Trades</p>
              <p className="text-lg font-bold text-white">{result.totalTrades}</p>
            </Card>
            <Card className="text-center">
              <p className="text-xs text-white/50 mb-1">Ganho Médio</p>
              <p className="text-lg font-bold text-green-400">+{PCT.format(result.avgWin)}%</p>
            </Card>
            <Card className="text-center">
              <p className="text-xs text-white/50 mb-1">Perda Média</p>
              <p className="text-lg font-bold text-red-400">-{PCT.format(result.avgLoss)}%</p>
            </Card>
          </div>

          {/* Equity Curve */}
          {equityData.length > 0 && (
            <Card className="p-6">
              <h3 className="text-sm font-semibold text-white mb-4">Curva de Capital</h3>
              <ResponsiveContainer width="100%" height={280}>
                <LineChart data={equityData} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis
                    dataKey="date"
                    tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 11 }}
                    tickLine={false}
                    axisLine={false}
                    interval="preserveStartEnd"
                  />
                  <YAxis
                    tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 11 }}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(v) =>
                      new Intl.NumberFormat('pt-BR', {
                        notation: 'compact',
                        style: 'currency',
                        currency: 'BRL',
                      }).format(v)
                    }
                    width={80}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#1a1a1a',
                      border: '1px solid rgba(255,255,255,0.1)',
                      borderRadius: '8px',
                      color: '#fff',
                    }}
                    formatter={(value: number) => [BRL.format(value), 'Capital']}
                    labelStyle={{ color: 'rgba(255,255,255,0.5)', fontSize: 12 }}
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
            </Card>
          )}

          {/* Trades Table */}
          {result.trades.length > 0 && (
            <Card className="p-0 overflow-hidden">
              <div className="px-6 py-4 border-b border-white/10">
                <h3 className="text-sm font-semibold text-white">
                  Operações ({result.trades.length})
                </h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-white/40 border-b border-white/5 bg-white/[0.02]">
                      <th className="text-left px-4 py-3 font-medium">Entrada</th>
                      <th className="text-left px-4 py-3 font-medium">Saída</th>
                      <th className="text-right px-4 py-3 font-medium">Preço Entrada</th>
                      <th className="text-right px-4 py-3 font-medium">Preço Saída</th>
                      <th className="text-right px-4 py-3 font-medium">P&L %</th>
                      <th className="text-left px-4 py-3 font-medium">Motivo Saída</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.trades.map((trade, i) => (
                      <tr
                        key={i}
                        className="border-b border-white/5 last:border-0 hover:bg-white/[0.02] transition-colors"
                      >
                        <td className="px-4 py-3 text-white/70 whitespace-nowrap">
                          {format(new Date(trade.entryDate), 'dd/MM/yyyy', { locale: ptBR })}
                        </td>
                        <td className="px-4 py-3 text-white/70 whitespace-nowrap">
                          {format(new Date(trade.exitDate), 'dd/MM/yyyy', { locale: ptBR })}
                        </td>
                        <td className="px-4 py-3 text-right text-white/80">
                          {BRL.format(trade.entryPrice)}
                        </td>
                        <td className="px-4 py-3 text-right text-white/80">
                          {BRL.format(trade.exitPrice)}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <span
                            className={`font-medium ${trade.pnlPercent >= 0 ? 'text-green-400' : 'text-red-400'}`}
                          >
                            {trade.pnlPercent >= 0 ? '+' : ''}
                            {PCT.format(trade.pnlPercent)}%
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <Badge
                            variant={
                              trade.exitReason === 'TAKE_PROFIT'
                                ? 'success'
                                : trade.exitReason === 'STOP_LOSS'
                                ? 'danger'
                                : 'default'
                            }
                          >
                            {trade.exitReason === 'TAKE_PROFIT'
                              ? 'Take Profit'
                              : trade.exitReason === 'STOP_LOSS'
                              ? 'Stop Loss'
                              : trade.exitReason === 'SIGNAL'
                              ? 'Sinal'
                              : trade.exitReason}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          {result.trades.length === 0 && (
            <Card className="text-center py-10">
              <p className="text-white/40 text-sm">
                Nenhuma operação foi executada neste período com a estratégia configurada.
              </p>
              <p className="text-white/30 text-xs mt-1">
                Tente ajustar os parâmetros ou aumentar o período de histórico.
              </p>
            </Card>
          )}
        </div>
      )}
    </div>
  )
}
