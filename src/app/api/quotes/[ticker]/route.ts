import { NextRequest, NextResponse } from 'next/server'
import { getQuote } from '@/lib/quotes'
import { quoteRateLimit, getIP } from '@/lib/rate-limit'
import { AssetType } from '@prisma/client'

export async function GET(
  req: NextRequest,
  { params }: { params: { ticker: string } }
) {
  const ip = getIP(req)
  const { success } = await quoteRateLimit.limit(ip)

  if (!success) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 })
  }

  const { ticker } = params
  const type = (req.nextUrl.searchParams.get('type') ?? 'STOCK_BR') as AssetType

  const quote = await getQuote(ticker.toUpperCase(), type)

  if (!quote) {
    return NextResponse.json({ error: 'Quote not found' }, { status: 404 })
  }

  return NextResponse.json(quote)
}
