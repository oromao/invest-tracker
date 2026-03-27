import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getQuote } from '@/lib/quotes'
import { calculatePosition, PortfolioSummary } from '@/lib/portfolio'

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Busca todas as trades do usuário com asset
  const trades = await prisma.trade.findMany({
    where: { userId: session.user.id },
    include: { asset: true },
    orderBy: { date: 'asc' },
  })

  // Agrupa por ativo
  const byAsset = trades.reduce((acc, trade) => {
    const key = trade.assetId
    if (!acc[key]) acc[key] = { asset: trade.asset, trades: [] }
    acc[key].trades.push(trade)
    return acc
  }, {} as Record<string, { asset: typeof trades[0]['asset']; trades: typeof trades }>)

  // Calcula posição e busca cotação para cada ativo
  const positionPromises = Object.values(byAsset).map(async ({ asset, trades }) => {
    const quote = await getQuote(asset.ticker, asset.type)
    const currentPrice = quote?.price ?? 0
    return calculatePosition(trades, currentPrice, asset)
  })

  const positions = (await Promise.all(positionPromises)).filter(
    p => p.quantity > 0  // filtra posições zeradas
  )

  const totalValue = positions.reduce((acc, p) => acc + p.currentValue, 0)
  const totalCost = positions.reduce((acc, p) => acc + p.totalCost, 0)
  const totalPnl = totalValue - totalCost
  const totalPnlPercent = totalCost > 0 ? (totalPnl / totalCost) * 100 : 0

  const summary: PortfolioSummary = {
    positions,
    totalValue,
    totalCost,
    totalPnl,
    totalPnlPercent,
    byType: positions.reduce((acc, p) => {
      if (!acc[p.asset.type]) acc[p.asset.type] = { value: 0, pnl: 0 }
      acc[p.asset.type].value += p.currentValue
      acc[p.asset.type].pnl += p.pnl
      return acc
    }, {} as PortfolioSummary['byType']),
  }

  return NextResponse.json(summary)
}
