/**
 * backtest.ts — Engine de backtesting de estratégias para criptomoedas
 *
 * Estratégias disponíveis:
 *   SMA_CROSSOVER — Cruzamento de médias simples (ex: SMA9 x SMA21)
 *   EMA_CROSSOVER — Cruzamento de médias exponenciais
 *   RSI           — Compra em sobrevenda, vende em sobrecompra
 *   MACD          — Cruzamento da linha MACD com a linha de sinal
 *   BOLLINGER     — Compra na banda inferior, vende na banda superior
 */

import { OHLCV, sma, ema, rsi, macd, bollingerBands } from './indicators'

// ─── Types ────────────────────────────────────────────────────────────────

export type StrategyType = 'SMA_CROSSOVER' | 'EMA_CROSSOVER' | 'RSI' | 'MACD' | 'BOLLINGER'

export interface StrategyParams {
  type: StrategyType
  // SMA / EMA Crossover
  fastPeriod?: number     // default: 9
  slowPeriod?: number     // default: 21
  // RSI
  rsiPeriod?: number      // default: 14
  rsiOversold?: number    // default: 30
  rsiOverbought?: number  // default: 70
  // MACD
  macdFast?: number       // default: 12
  macdSlow?: number       // default: 26
  macdSignal?: number     // default: 9
  // Bollinger
  bbPeriod?: number       // default: 20
  bbStdDev?: number       // default: 2
}

export interface BacktestConfig {
  ticker: string
  candles: OHLCV[]
  strategy: StrategyParams
  initialCapital: number  // em BRL
  feePercent?: number     // comissão por operação (default: 0.1%)
  stopLoss?: number       // stop loss em % (ex: 5 → -5%)
  takeProfit?: number     // take profit em % (ex: 15 → +15%)
}

export type SignalType = 'BUY' | 'SELL'

export interface Signal {
  index: number
  date: Date
  type: SignalType
  price: number
  reason: string
}

export interface BacktestTrade {
  entryDate: Date
  exitDate: Date
  entryPrice: number
  exitPrice: number
  quantity: number
  pnl: number
  pnlPercent: number
  fees: number
  exitReason: 'SIGNAL' | 'STOP_LOSS' | 'TAKE_PROFIT' | 'END_OF_DATA'
}

export interface EquityPoint {
  date: Date
  equity: number
  drawdown: number
}

export interface BacktestResult {
  strategy: StrategyParams
  ticker: string
  startDate: Date
  endDate: Date
  initialCapital: number
  finalCapital: number
  totalReturn: number       // %
  annualizedReturn: number  // %
  sharpeRatio: number
  maxDrawdown: number       // %
  winRate: number           // %
  profitFactor: number
  totalTrades: number
  winningTrades: number
  losingTrades: number
  avgWin: number            // % médio dos trades vencedores
  avgLoss: number           // % médio dos trades perdedores
  trades: BacktestTrade[]
  equityCurve: EquityPoint[]
  signals: Signal[]
}

// ─── Geração de sinais por estratégia ────────────────────────────────────

function smaCrossoverSignals(candles: OHLCV[], p: StrategyParams): Signal[] {
  const closes = candles.map(c => c.close)
  const fast = sma(closes, p.fastPeriod ?? 9)
  const slow = sma(closes, p.slowPeriod ?? 21)
  const signals: Signal[] = []

  for (let i = 1; i < candles.length; i++) {
    if (fast[i] === null || slow[i] === null || fast[i - 1] === null || slow[i - 1] === null) continue

    const prevDiff = (fast[i - 1] as number) - (slow[i - 1] as number)
    const currDiff = (fast[i] as number) - (slow[i] as number)

    if (prevDiff <= 0 && currDiff > 0) {
      signals.push({
        index: i, date: candles[i].date, type: 'BUY', price: candles[i].close,
        reason: `SMA${p.fastPeriod ?? 9} cruzou acima da SMA${p.slowPeriod ?? 21}`,
      })
    } else if (prevDiff >= 0 && currDiff < 0) {
      signals.push({
        index: i, date: candles[i].date, type: 'SELL', price: candles[i].close,
        reason: `SMA${p.fastPeriod ?? 9} cruzou abaixo da SMA${p.slowPeriod ?? 21}`,
      })
    }
  }

  return signals
}

function emaCrossoverSignals(candles: OHLCV[], p: StrategyParams): Signal[] {
  const closes = candles.map(c => c.close)
  const fast = ema(closes, p.fastPeriod ?? 9)
  const slow = ema(closes, p.slowPeriod ?? 21)
  const signals: Signal[] = []

  for (let i = 1; i < candles.length; i++) {
    if (fast[i] === null || slow[i] === null || fast[i - 1] === null || slow[i - 1] === null) continue

    const prevDiff = (fast[i - 1] as number) - (slow[i - 1] as number)
    const currDiff = (fast[i] as number) - (slow[i] as number)

    if (prevDiff <= 0 && currDiff > 0) {
      signals.push({
        index: i, date: candles[i].date, type: 'BUY', price: candles[i].close,
        reason: `EMA${p.fastPeriod ?? 9} cruzou acima da EMA${p.slowPeriod ?? 21}`,
      })
    } else if (prevDiff >= 0 && currDiff < 0) {
      signals.push({
        index: i, date: candles[i].date, type: 'SELL', price: candles[i].close,
        reason: `EMA${p.fastPeriod ?? 9} cruzou abaixo da EMA${p.slowPeriod ?? 21}`,
      })
    }
  }

  return signals
}

function rsiSignals(candles: OHLCV[], p: StrategyParams): Signal[] {
  const closes = candles.map(c => c.close)
  const rsiValues = rsi(closes, p.rsiPeriod ?? 14)
  const oversold = p.rsiOversold ?? 30
  const overbought = p.rsiOverbought ?? 70
  const signals: Signal[] = []

  for (let i = 1; i < candles.length; i++) {
    if (rsiValues[i] === null || rsiValues[i - 1] === null) continue

    const prev = rsiValues[i - 1] as number
    const curr = rsiValues[i] as number

    // Compra quando RSI sai da zona de sobrevenda (cruza acima do nível)
    if (prev <= oversold && curr > oversold) {
      signals.push({
        index: i, date: candles[i].date, type: 'BUY', price: candles[i].close,
        reason: `RSI saiu de sobrevenda: ${curr.toFixed(1)}`,
      })
    }
    // Vende quando RSI sai da zona de sobrecompra (cruza abaixo do nível)
    else if (prev >= overbought && curr < overbought) {
      signals.push({
        index: i, date: candles[i].date, type: 'SELL', price: candles[i].close,
        reason: `RSI saiu de sobrecompra: ${curr.toFixed(1)}`,
      })
    }
  }

  return signals
}

function macdSignals(candles: OHLCV[], p: StrategyParams): Signal[] {
  const closes = candles.map(c => c.close)
  const macdData = macd(closes, p.macdFast ?? 12, p.macdSlow ?? 26, p.macdSignal ?? 9)
  const signals: Signal[] = []

  for (let i = 1; i < candles.length; i++) {
    const prev = macdData[i - 1]
    const curr = macdData[i]

    if (
      prev.macd === null || prev.signal === null ||
      curr.macd === null || curr.signal === null
    ) continue

    const prevDiff = prev.macd - prev.signal
    const currDiff = curr.macd - curr.signal

    if (prevDiff <= 0 && currDiff > 0) {
      signals.push({
        index: i, date: candles[i].date, type: 'BUY', price: candles[i].close,
        reason: `MACD cruzou acima da linha de sinal`,
      })
    } else if (prevDiff >= 0 && currDiff < 0) {
      signals.push({
        index: i, date: candles[i].date, type: 'SELL', price: candles[i].close,
        reason: `MACD cruzou abaixo da linha de sinal`,
      })
    }
  }

  return signals
}

function bollingerSignals(candles: OHLCV[], p: StrategyParams): Signal[] {
  const closes = candles.map(c => c.close)
  const bands = bollingerBands(closes, p.bbPeriod ?? 20, p.bbStdDev ?? 2)
  const signals: Signal[] = []

  for (let i = 1; i < candles.length; i++) {
    const band = bands[i]
    const prevBand = bands[i - 1]
    if (band.upper === null || band.lower === null || prevBand.lower === null) continue

    const price = candles[i].close
    const prevPrice = candles[i - 1].close
    const lower = band.lower as number
    const prevLower = prevBand.lower as number
    const upper = band.upper as number

    // Compra: preço cruzou acima da banda inferior (saiu da zona de venda)
    if (prevPrice <= prevLower && price > lower) {
      signals.push({
        index: i, date: candles[i].date, type: 'BUY', price,
        reason: `Preço voltou acima da banda inferior (${lower.toFixed(2)})`,
      })
    }
    // Vende: preço tocou ou ultrapassou a banda superior
    else if (price >= upper) {
      signals.push({
        index: i, date: candles[i].date, type: 'SELL', price,
        reason: `Preço atingiu a banda superior (${upper.toFixed(2)})`,
      })
    }
  }

  return signals
}

function generateSignals(candles: OHLCV[], params: StrategyParams): Signal[] {
  switch (params.type) {
    case 'SMA_CROSSOVER': return smaCrossoverSignals(candles, params)
    case 'EMA_CROSSOVER': return emaCrossoverSignals(candles, params)
    case 'RSI':           return rsiSignals(candles, params)
    case 'MACD':          return macdSignals(candles, params)
    case 'BOLLINGER':     return bollingerSignals(candles, params)
  }
}

// ─── Engine principal ─────────────────────────────────────────────────────

export function runBacktest(config: BacktestConfig): BacktestResult {
  const { candles, strategy, initialCapital, ticker } = config
  const feePercent = config.feePercent ?? 0.1
  const stopLoss = config.stopLoss
  const takeProfit = config.takeProfit

  if (candles.length === 0) {
    throw new Error('Nenhum candle fornecido para o backtest')
  }

  const signals = generateSignals(candles, strategy)
  const signalMap = new Map<number, SignalType>()
  for (const sig of signals) {
    // Apenas o primeiro sinal por índice é válido
    if (!signalMap.has(sig.index)) signalMap.set(sig.index, sig.type)
  }

  let capital = initialCapital
  let inPosition = false
  let entryPrice = 0
  let entryDate = new Date()
  let quantity = 0

  const trades: BacktestTrade[] = []
  const equityCurve: EquityPoint[] = []
  let peakEquity = initialCapital
  let maxDrawdown = 0

  for (let i = 0; i < candles.length; i++) {
    const candle = candles[i]
    const price = candle.close

    // Checa condições de saída se estiver posicionado
    if (inPosition) {
      const pnlPct = ((price - entryPrice) / entryPrice) * 100
      let exitReason: BacktestTrade['exitReason'] | null = null
      let exitPrice = price

      if (stopLoss && pnlPct <= -stopLoss) {
        exitReason = 'STOP_LOSS'
        exitPrice = entryPrice * (1 - stopLoss / 100)
      } else if (takeProfit && pnlPct >= takeProfit) {
        exitReason = 'TAKE_PROFIT'
        exitPrice = entryPrice * (1 + takeProfit / 100)
      } else if (signalMap.get(i) === 'SELL') {
        exitReason = 'SIGNAL'
      }

      if (exitReason) {
        const fees = quantity * exitPrice * (feePercent / 100)
        const received = quantity * exitPrice - fees
        const pnl = received - (quantity * entryPrice)
        capital = received

        trades.push({
          entryDate,
          exitDate: candle.date,
          entryPrice,
          exitPrice,
          quantity,
          pnl,
          pnlPercent: ((exitPrice - entryPrice) / entryPrice) * 100,
          fees,
          exitReason,
        })

        inPosition = false
      }
    }

    // Abre posição em sinal de compra (usa 100% do capital disponível)
    if (!inPosition && signalMap.get(i) === 'BUY' && capital > 0) {
      const fees = capital * (feePercent / 100)
      const investable = capital - fees
      quantity = investable / price
      capital = 0
      entryPrice = price
      entryDate = candle.date
      inPosition = true
    }

    // Equity e drawdown
    const currentEquity = inPosition ? quantity * price : capital
    if (currentEquity > peakEquity) peakEquity = currentEquity
    const drawdown = peakEquity > 0 ? ((peakEquity - currentEquity) / peakEquity) * 100 : 0
    if (drawdown > maxDrawdown) maxDrawdown = drawdown

    equityCurve.push({ date: candle.date, equity: currentEquity, drawdown })
  }

  // Fecha posição aberta no último candle
  if (inPosition) {
    const last = candles[candles.length - 1]
    const exitPrice = last.close
    const fees = quantity * exitPrice * (feePercent / 100)
    const received = quantity * exitPrice - fees
    const pnl = received - quantity * entryPrice
    capital = received

    trades.push({
      entryDate,
      exitDate: last.date,
      entryPrice,
      exitPrice,
      quantity,
      pnl,
      pnlPercent: ((exitPrice - entryPrice) / entryPrice) * 100,
      fees,
      exitReason: 'END_OF_DATA',
    })
  }

  const finalCapital = capital
  const totalReturn = ((finalCapital - initialCapital) / initialCapital) * 100

  const daysElapsed = Math.max(
    1,
    (candles[candles.length - 1].date.getTime() - candles[0].date.getTime()) / 86_400_000
  )
  const annualizedReturn = ((1 + totalReturn / 100) ** (365 / daysElapsed) - 1) * 100

  const winners = trades.filter(t => t.pnl > 0)
  const losers = trades.filter(t => t.pnl <= 0)
  const winRate = trades.length > 0 ? (winners.length / trades.length) * 100 : 0
  const avgWin = winners.length > 0 ? winners.reduce((a, t) => a + t.pnlPercent, 0) / winners.length : 0
  const avgLoss = losers.length > 0 ? losers.reduce((a, t) => a + t.pnlPercent, 0) / losers.length : 0
  const grossProfit = winners.reduce((a, t) => a + t.pnl, 0)
  const grossLoss = Math.abs(losers.reduce((a, t) => a + t.pnl, 0))
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0

  // Sharpe Ratio diário anualizado (taxa livre de risco = 0)
  const dailyReturns = equityCurve.slice(1).map((p, i) => {
    const prev = equityCurve[i].equity
    return prev > 0 ? (p.equity - prev) / prev : 0
  })
  const avgDailyReturn = dailyReturns.reduce((a, b) => a + b, 0) / (dailyReturns.length || 1)
  const stdDailyReturn = Math.sqrt(
    dailyReturns.reduce((a, r) => a + Math.pow(r - avgDailyReturn, 2), 0) / (dailyReturns.length || 1)
  )
  const sharpeRatio = stdDailyReturn > 0 ? (avgDailyReturn / stdDailyReturn) * Math.sqrt(365) : 0

  return {
    strategy,
    ticker,
    startDate: candles[0].date,
    endDate: candles[candles.length - 1].date,
    initialCapital,
    finalCapital,
    totalReturn,
    annualizedReturn,
    sharpeRatio,
    maxDrawdown,
    winRate,
    profitFactor,
    totalTrades: trades.length,
    winningTrades: winners.length,
    losingTrades: losers.length,
    avgWin,
    avgLoss,
    trades,
    equityCurve,
    signals,
  }
}
