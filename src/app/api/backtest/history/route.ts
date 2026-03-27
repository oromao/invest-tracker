/**
 * POST /api/backtest/history
 *
 * Busca dados OHLCV históricos de uma cripto no CoinGecko e persiste
 * na tabela PriceHistory para uso em backtests.
 *
 * Body: { ticker: string, days: 30 | 90 | 180 | 365 | 730 | "max" }
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'

const COINGECKO_IDS: Record<string, string> = {
  BTC:  'bitcoin',
  ETH:  'ethereum',
  BNB:  'binancecoin',
  SOL:  'solana',
  ADA:  'cardano',
  DOT:  'polkadot',
  MATIC: 'matic-network',
  LINK: 'chainlink',
  AVAX: 'avalanche-2',
  ATOM: 'cosmos',
  XRP:  'ripple',
  DOGE: 'dogecoin',
  LTC:  'litecoin',
  UNI:  'uniswap',
}

const schema = z.object({
  ticker: z.string().min(1).max(20).transform(s => s.toUpperCase()),
  days: z.union([
    z.literal(30),
    z.literal(90),
    z.literal(180),
    z.literal(365),
    z.literal(730),
    z.literal('max'),
  ]).default(365),
})

interface OHLCEntry {
  date: Date
  open: number
  high: number
  low: number
  close: number
}

async function fetchCoinGeckoOHLC(coinId: string, days: number | 'max'): Promise<OHLCEntry[]> {
  // CoinGecko OHLC: aceita 1, 7, 14, 30, 90, 180, 365
  // Para 730/max usamos market_chart (só close + volume)
  const daysParam = days === 'max' ? 'max' : days

  if (typeof days === 'number' && days > 365) {
    // Fallback para market_chart quando > 365 dias (OHLC não suporta)
    const url = `https://api.coingecko.com/api/v3/coins/${coinId}/market_chart?vs_currency=brl&days=${daysParam}&interval=daily`
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      next: { revalidate: 0 },
    })
    if (!res.ok) throw new Error(`CoinGecko market_chart falhou: ${res.status}`)

    const data = await res.json()
    const prices: [number, number][] = data.prices ?? []

    return prices.map(([ts, close]) => {
      const d = new Date(ts)
      d.setUTCHours(0, 0, 0, 0)
      return { date: d, open: close, high: close, low: close, close }
    })
  }

  const url = `https://api.coingecko.com/api/v3/coins/${coinId}/ohlc?vs_currency=brl&days=${daysParam}`
  const res = await fetch(url, {
    headers: { Accept: 'application/json' },
    next: { revalidate: 0 },
  })
  if (!res.ok) throw new Error(`CoinGecko OHLC falhou: ${res.status}`)

  const data: [number, number, number, number, number][] = await res.json()

  // Agrega candles intra-day em candles diários (CoinGecko retorna 4h para ≤90 dias)
  const byDay = new Map<string, OHLCEntry>()
  for (const [ts, open, high, low, close] of data) {
    const d = new Date(ts)
    d.setUTCHours(0, 0, 0, 0)
    const key = d.toISOString().slice(0, 10)

    if (!byDay.has(key)) {
      byDay.set(key, { date: d, open, high, low, close })
    } else {
      const existing = byDay.get(key)!
      existing.high = Math.max(existing.high, high)
      existing.low = Math.min(existing.low, low)
      existing.close = close // último candle do dia
    }
  }

  return Array.from(byDay.values()).sort((a, b) => a.date.getTime() - b.date.getTime())
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }

  const { ticker, days } = parsed.data
  const coinId = COINGECKO_IDS[ticker] ?? ticker.toLowerCase()

  // Busca ou cria o asset no banco
  let asset = await prisma.asset.findUnique({ where: { ticker } })
  if (!asset) {
    asset = await prisma.asset.create({
      data: {
        ticker,
        name: ticker,
        type: 'CRYPTO',
        currency: 'BRL',
      },
    })
  }

  // Busca dados históricos do CoinGecko
  let candles: OHLCEntry[]
  try {
    candles = await fetchCoinGeckoOHLC(coinId, days)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro ao buscar dados do CoinGecko'
    return NextResponse.json({ error: message }, { status: 502 })
  }

  if (candles.length === 0) {
    return NextResponse.json({ error: 'Nenhum dado retornado pelo CoinGecko' }, { status: 404 })
  }

  // Upsert em lotes de 100 para não estourar o limite de conexões
  let upserted = 0
  const batchSize = 100
  for (let i = 0; i < candles.length; i += batchSize) {
    const batch = candles.slice(i, i + batchSize)
    const ops = batch.map(c =>
      prisma.priceHistory.upsert({
        where: { assetId_date: { assetId: asset!.id, date: c.date } },
        create: {
          assetId: asset!.id,
          date: c.date,
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
        },
        update: {
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
        },
      })
    )
    await prisma.$transaction(ops)
    upserted += batch.length
  }

  return NextResponse.json({
    ok: true,
    ticker,
    assetId: asset.id,
    candles: upserted,
    from: candles[0].date,
    to: candles[candles.length - 1].date,
  })
}
