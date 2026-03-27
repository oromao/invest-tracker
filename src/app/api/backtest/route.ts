/**
 * POST /api/backtest
 *
 * Executa um backtest de estratégia sobre dados históricos de cripto.
 * Os dados devem ter sido previamente carregados via POST /api/backtest/history.
 *
 * Body:
 * {
 *   ticker:         string          — ex: "BTC"
 *   strategy:       StrategyParams  — tipo e parâmetros da estratégia
 *   initialCapital: number          — capital inicial em BRL
 *   startDate?:     string          — ISO date (default: 1 ano atrás)
 *   endDate?:       string          — ISO date (default: hoje)
 *   feePercent?:    number          — taxa por operação em % (default: 0.1)
 *   stopLoss?:      number          — stop loss em % (ex: 5)
 *   takeProfit?:    number          — take profit em % (ex: 20)
 * }
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { runBacktest, StrategyType } from '@/lib/backtest'
import { OHLCV } from '@/lib/indicators'

const strategySchema = z.object({
  type: z.enum(['SMA_CROSSOVER', 'EMA_CROSSOVER', 'RSI', 'MACD', 'BOLLINGER'] as [StrategyType, ...StrategyType[]]),
  fastPeriod:     z.number().int().min(2).max(200).optional(),
  slowPeriod:     z.number().int().min(2).max(500).optional(),
  rsiPeriod:      z.number().int().min(2).max(100).optional(),
  rsiOversold:    z.number().min(1).max(49).optional(),
  rsiOverbought:  z.number().min(51).max(99).optional(),
  macdFast:       z.number().int().min(2).max(100).optional(),
  macdSlow:       z.number().int().min(2).max(200).optional(),
  macdSignal:     z.number().int().min(2).max(50).optional(),
  bbPeriod:       z.number().int().min(2).max(200).optional(),
  bbStdDev:       z.number().min(0.5).max(5).optional(),
})

const bodySchema = z.object({
  ticker:         z.string().min(1).max(20).transform(s => s.toUpperCase()),
  strategy:       strategySchema,
  initialCapital: z.number().positive().max(1_000_000_000),
  startDate:      z.string().datetime().optional(),
  endDate:        z.string().datetime().optional(),
  feePercent:     z.number().min(0).max(5).optional(),
  stopLoss:       z.number().min(0.1).max(99).optional(),
  takeProfit:     z.number().min(0.1).max(10000).optional(),
})

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }

  const {
    ticker,
    strategy,
    initialCapital,
    feePercent,
    stopLoss,
    takeProfit,
  } = parsed.data

  const endDate = parsed.data.endDate ? new Date(parsed.data.endDate) : new Date()
  const startDate = parsed.data.startDate
    ? new Date(parsed.data.startDate)
    : new Date(endDate.getTime() - 365 * 86_400_000)

  // Busca o asset
  const asset = await prisma.asset.findUnique({ where: { ticker } })
  if (!asset) {
    return NextResponse.json(
      { error: `Ativo "${ticker}" não encontrado. Use POST /api/backtest/history para carregar o histórico primeiro.` },
      { status: 404 }
    )
  }

  // Busca os candles no período
  const priceRows = await prisma.priceHistory.findMany({
    where: {
      assetId: asset.id,
      date: { gte: startDate, lte: endDate },
    },
    orderBy: { date: 'asc' },
  })

  if (priceRows.length < 30) {
    return NextResponse.json(
      {
        error: `Dados insuficientes: apenas ${priceRows.length} candle(s) encontrado(s) para o período. ` +
          `Use POST /api/backtest/history para carregar mais dados.`,
      },
      { status: 422 }
    )
  }

  const candles: OHLCV[] = priceRows.map(row => ({
    date:   row.date,
    open:   row.open  ?? row.close,
    high:   row.high  ?? row.close,
    low:    row.low   ?? row.close,
    close:  row.close,
    volume: row.volume ?? 0,
  }))

  const result = runBacktest({
    ticker,
    candles,
    strategy,
    initialCapital,
    feePercent,
    stopLoss,
    takeProfit,
  })

  // Limita a resposta: equity curve com pontos semanais para não estourar payload
  const sparseEquity = result.equityCurve.filter((_, i) => i % 7 === 0)

  return NextResponse.json({
    ...result,
    equityCurve: sparseEquity,
    // Arredonda métricas para 2 casas decimais
    totalReturn:      +result.totalReturn.toFixed(2),
    annualizedReturn: +result.annualizedReturn.toFixed(2),
    sharpeRatio:      +result.sharpeRatio.toFixed(3),
    maxDrawdown:      +result.maxDrawdown.toFixed(2),
    winRate:          +result.winRate.toFixed(2),
    profitFactor:     isFinite(result.profitFactor) ? +result.profitFactor.toFixed(3) : null,
    avgWin:           +result.avgWin.toFixed(2),
    avgLoss:          +result.avgLoss.toFixed(2),
    finalCapital:     +result.finalCapital.toFixed(2),
  })
}
