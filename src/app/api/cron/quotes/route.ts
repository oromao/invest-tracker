import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { fetchCryptoQuotesBatch, getQuote } from '@/lib/quotes'
import { redis } from '@/lib/cache'

export async function POST(req: NextRequest) {
  // Protege endpoint com CRON_SECRET
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    // Busca todos os assets distintos que têm trades
    const assets = await prisma.asset.findMany({
      where: {
        trades: { some: {} },
      },
    })

    // Separa por tipo
    const cryptoAssets = assets.filter(a => a.type === 'CRYPTO')
    const stockAssets = assets.filter(a => a.type !== 'CRYPTO')

    // Crypto: batch request (mais eficiente, respeita rate limit)
    if (cryptoAssets.length > 0) {
      const quotes = await fetchCryptoQuotesBatch(cryptoAssets.map(a => a.ticker))
      for (const quote of quotes) {
        await redis.setex(`quote:${quote.ticker}`, 60, JSON.stringify(quote))
      }
    }

    // Ações: requests individuais (Yahoo Finance não tem batch público)
    for (const asset of stockAssets) {
      await getQuote(asset.ticker, asset.type)
      // pequeno delay para evitar bloqueio
      await new Promise(r => setTimeout(r, 200))
    }

    return NextResponse.json({
      ok: true,
      updated: assets.length,
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    console.error('Cron quotes error:', error)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
