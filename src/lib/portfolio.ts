/**
 * portfolio.ts — Cálculos de P&L por Custo Médio (padrão B3)
 */

import { Trade, Asset, AssetType } from '@prisma/client'

export interface Position {
  asset: Asset
  quantity: number
  averagePrice: number
  currentPrice: number
  totalCost: number
  currentValue: number
  pnl: number
  pnlPercent: number
}

export interface PortfolioSummary {
  positions: Position[]
  totalValue: number
  totalCost: number
  totalPnl: number
  totalPnlPercent: number
  byType: Record<AssetType, { value: number; pnl: number }>
}

/**
 * Calcula posição de um ativo usando Custo Médio
 * Ações BR/FII: Custo Médio (obrigatório Receita Federal)
 * Crypto: FIFO por padrão, mas simplificado para CM aqui
 */
export function calculatePosition(
  trades: Trade[],
  currentPrice: number,
  asset: Asset
): Position {
  // Ordena por data ASC (obrigatório para CM correto)
  const sorted = [...trades].sort((a, b) => a.date.getTime() - b.date.getTime())

  let totalQty = 0
  let totalCost = 0

  for (const trade of sorted) {
    if (trade.type === 'BUY') {
      totalCost += trade.quantity * trade.price + trade.fees
      totalQty += trade.quantity
    } else {
      // SELL: proporção do custo médio saindo
      if (totalQty > 0) {
        const sellRatio = trade.quantity / totalQty
        totalCost -= totalCost * sellRatio
        totalQty -= trade.quantity
      }
    }
  }

  // Arredonda para evitar floating point issues
  totalQty = Math.max(0, Math.round(totalQty * 1e8) / 1e8)
  totalCost = Math.max(0, totalCost)

  const averagePrice = totalQty > 0 ? totalCost / totalQty : 0
  const currentValue = totalQty * currentPrice
  const pnl = currentValue - totalCost
  const pnlPercent = totalCost > 0 ? (pnl / totalCost) * 100 : 0

  return {
    asset,
    quantity: totalQty,
    averagePrice,
    currentPrice,
    totalCost,
    currentValue,
    pnl,
    pnlPercent,
  }
}

/**
 * Calcula o ganho de capital para IR
 * Isento: ações até R$20.000/mês de vendas no BR
 */
export function calculateCapitalGain(
  sells: Trade[],
  avgPriceBefore: number
): {
  grossProfit: number
  netProfit: number
  totalSold: number
  isExempt: boolean  // vendas < R$20k/mês = isento no BR
} {
  const totalSold = sells.reduce((acc, s) => acc + s.total, 0)
  const costBasis = sells.reduce((acc, s) => acc + s.quantity * avgPriceBefore, 0)
  const fees = sells.reduce((acc, s) => acc + s.fees, 0)

  const grossProfit = totalSold - costBasis - fees
  const netProfit = grossProfit  // IR calculado externamente (15% ou 20%)

  return {
    grossProfit,
    netProfit,
    totalSold,
    isExempt: totalSold < 20000,
  }
}
