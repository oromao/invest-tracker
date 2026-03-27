/**
 * indicators.ts — Indicadores técnicos para análise de séries temporais
 */

export interface OHLCV {
  date: Date
  open: number
  high: number
  low: number
  close: number
  volume: number
}

/** Média Móvel Simples */
export function sma(prices: number[], period: number): (number | null)[] {
  return prices.map((_, i) => {
    if (i < period - 1) return null
    const slice = prices.slice(i - period + 1, i + 1)
    return slice.reduce((a, b) => a + b, 0) / period
  })
}

/** Média Móvel Exponencial */
export function ema(prices: number[], period: number): (number | null)[] {
  const result: (number | null)[] = new Array(prices.length).fill(null)
  const k = 2 / (period + 1)

  if (prices.length < period) return result

  const firstSma = prices.slice(0, period).reduce((a, b) => a + b, 0) / period
  result[period - 1] = firstSma

  for (let i = period; i < prices.length; i++) {
    result[i] = prices[i] * k + (result[i - 1] as number) * (1 - k)
  }

  return result
}

/** RSI — Relative Strength Index (Wilder) */
export function rsi(prices: number[], period = 14): (number | null)[] {
  const result: (number | null)[] = new Array(prices.length).fill(null)
  if (prices.length <= period) return result

  const changes = prices.slice(1).map((p, i) => p - prices[i])

  // Primeira média: SMA simples
  let avgGain =
    changes.slice(0, period).filter(c => c > 0).reduce((a, b) => a + b, 0) / period
  let avgLoss =
    Math.abs(changes.slice(0, period).filter(c => c < 0).reduce((a, b) => a + b, 0)) / period

  result[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss)

  // Suavização de Wilder
  for (let i = period + 1; i < prices.length; i++) {
    const change = changes[i - 1]
    const gain = change > 0 ? change : 0
    const loss = change < 0 ? Math.abs(change) : 0

    avgGain = (avgGain * (period - 1) + gain) / period
    avgLoss = (avgLoss * (period - 1) + loss) / period

    result[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss)
  }

  return result
}

export interface MACDResult {
  macd: number | null
  signal: number | null
  histogram: number | null
}

/** MACD — Moving Average Convergence Divergence */
export function macd(
  prices: number[],
  fastPeriod = 12,
  slowPeriod = 26,
  signalPeriod = 9
): MACDResult[] {
  const fastEma = ema(prices, fastPeriod)
  const slowEma = ema(prices, slowPeriod)

  const macdLine: (number | null)[] = prices.map((_, i) => {
    if (fastEma[i] === null || slowEma[i] === null) return null
    return (fastEma[i] as number) - (slowEma[i] as number)
  })

  // Signal = EMA(signalPeriod) sobre os valores não-nulos do MACD
  const firstMacdIdx = macdLine.findIndex(v => v !== null)
  const macdValues = macdLine.slice(firstMacdIdx).map(v => v as number)
  const signalValues = ema(macdValues, signalPeriod)

  const signalLine: (number | null)[] = new Array(prices.length).fill(null)
  signalValues.forEach((v, i) => {
    signalLine[firstMacdIdx + i] = v
  })

  return prices.map((_, i) => ({
    macd: macdLine[i],
    signal: signalLine[i],
    histogram:
      macdLine[i] !== null && signalLine[i] !== null
        ? (macdLine[i] as number) - (signalLine[i] as number)
        : null,
  }))
}

export interface BollingerBand {
  upper: number | null
  middle: number | null
  lower: number | null
}

/** Bandas de Bollinger */
export function bollingerBands(
  prices: number[],
  period = 20,
  stdDevMultiplier = 2
): BollingerBand[] {
  const middle = sma(prices, period)

  return prices.map((_, i) => {
    if (middle[i] === null) return { upper: null, middle: null, lower: null }

    const slice = prices.slice(i - period + 1, i + 1)
    const mean = middle[i] as number
    const variance = slice.reduce((acc, p) => acc + Math.pow(p - mean, 2), 0) / period
    const stdDev = Math.sqrt(variance)

    return {
      upper: mean + stdDevMultiplier * stdDev,
      middle: mean,
      lower: mean - stdDevMultiplier * stdDev,
    }
  })
}
