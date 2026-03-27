/**
 * quotes.ts — Abstração sobre APIs de cotações externas
 * Ordem de prioridade: Redis cache → CoinGecko (crypto) | Yahoo Finance (ações)
 */

import { redis } from './cache'
import { AssetType } from '@prisma/client'

export interface Quote {
  ticker: string
  price: number
  change24h?: number
  changePercent?: number
  volume?: number
  updatedAt: string
}

const CACHE_TTL = {
  CRYPTO: 60,       // 1 min
  STOCK_BR: 300,    // 5 min (pregão BR)
  STOCK_US: 300,    // 5 min (pregão US)
  FII: 300,
  OPTION: 120,
  OFF_HOURS: 3600,  // 1h fora do pregão
}

// ─── Yahoo Finance ────────────────────────────────────────────────────────

async function fetchYahooQuote(yahooTicker: string): Promise<Quote | null> {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${yahooTicker}`
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept': 'application/json',
      },
      next: { revalidate: 0 },
    })

    if (!res.ok) return null

    const data = await res.json()
    const result = data?.chart?.result?.[0]
    if (!result) return null

    const meta = result.meta
    const price = meta.regularMarketPrice ?? meta.previousClose

    return {
      ticker: yahooTicker,
      price,
      change24h: price - (meta.previousClose ?? price),
      changePercent: meta.regularMarketChangePercent,
      volume: meta.regularMarketVolume,
      updatedAt: new Date().toISOString(),
    }
  } catch {
    return null
  }
}

// ─── CoinGecko ────────────────────────────────────────────────────────────

const COINGECKO_IDS: Record<string, string> = {
  BTC: 'bitcoin',
  ETH: 'ethereum',
  BNB: 'binancecoin',
  SOL: 'solana',
  ADA: 'cardano',
  DOT: 'polkadot',
  MATIC: 'matic-network',
  LINK: 'chainlink',
  AVAX: 'avalanche-2',
  ATOM: 'cosmos',
}

async function fetchCoinGeckoQuote(ticker: string): Promise<Quote | null> {
  try {
    const id = COINGECKO_IDS[ticker.toUpperCase()] ?? ticker.toLowerCase()
    const url = `https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=brl&include_24hr_change=true&include_24hr_vol=true`

    const res = await fetch(url, {
      headers: { 'Accept': 'application/json' },
      next: { revalidate: 0 },
    })

    if (!res.ok) return null

    const data = await res.json()
    const coinData = data[id]
    if (!coinData) return null

    return {
      ticker,
      price: coinData.brl,
      change24h: coinData.brl_24h_change,
      changePercent: coinData.brl_24h_change,
      volume: coinData.brl_24h_vol,
      updatedAt: new Date().toISOString(),
    }
  } catch {
    return null
  }
}

// ─── Batch CoinGecko ──────────────────────────────────────────────────────

export async function fetchCryptoQuotesBatch(tickers: string[]): Promise<Quote[]> {
  try {
    const ids = tickers
      .map(t => COINGECKO_IDS[t.toUpperCase()] ?? t.toLowerCase())
      .join(',')

    const url = `https://api.coingecko.com/api/v3/coins/markets?vs_currency=brl&ids=${ids}&per_page=250`
    const res = await fetch(url, {
      headers: { 'Accept': 'application/json' },
      next: { revalidate: 0 },
    })

    if (!res.ok) return []

    const data = await res.json()
    return data.map((coin: any) => ({
      ticker: coin.symbol.toUpperCase(),
      price: coin.current_price,
      change24h: coin.price_change_24h,
      changePercent: coin.price_change_percentage_24h,
      volume: coin.total_volume,
      updatedAt: new Date().toISOString(),
    }))
  } catch {
    return []
  }
}

// ─── Main: getQuote ───────────────────────────────────────────────────────

export async function getQuote(ticker: string, type: AssetType): Promise<Quote | null> {
  const cacheKey = `quote:${ticker}`

  // 1. Check Redis cache
  const cached = await redis.get<Quote>(cacheKey)
  if (cached) return cached

  // 2. Fetch from appropriate source
  let quote: Quote | null = null

  if (type === 'CRYPTO') {
    quote = await fetchCoinGeckoQuote(ticker)
  } else {
    // B3 stocks need .SA suffix
    const yahooTicker =
      type === 'STOCK_BR' || type === 'FII'
        ? `${ticker}.SA`
        : ticker

    quote = await fetchYahooQuote(yahooTicker)
  }

  if (!quote) return null

  // 3. Cache result
  const ttl = type === 'CRYPTO' ? CACHE_TTL.CRYPTO : CACHE_TTL.STOCK_BR
  await redis.setex(cacheKey, ttl, JSON.stringify(quote))

  return quote
}

// ─── Normalize ticker ─────────────────────────────────────────────────────

export function toYahooTicker(ticker: string, type: AssetType): string {
  if (type === 'STOCK_BR' || type === 'FII') return `${ticker}.SA`
  return ticker
}
