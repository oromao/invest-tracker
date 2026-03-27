/**
 * GET /api/ir?month=2024-01
 *
 * Relatório de Imposto de Renda — ganho de capital por mês.
 * Calcula o lucro tributável, isenções e alíquota devida por tipo de ativo.
 *
 * Regras brasileiras implementadas:
 *   STOCK_BR  — 15% s/ lucro; isento se vendas totais < R$20.000/mês
 *   FII       — 20% s/ lucro; SEM isenção
 *   CRYPTO    — 15% s/ lucro; isento se vendas totais < R$35.000/mês
 *   STOCK_US  — 15% s/ lucro; SEM isenção (rendimento no exterior)
 *   OPTION    — 20% s/ lucro (tributação como day trade)
 */

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { AssetType } from '@prisma/client'

const TAX_RATE: Record<AssetType, number> = {
  STOCK_BR: 0.15,
  FII:      0.20,
  CRYPTO:   0.15,
  STOCK_US: 0.15,
  OPTION:   0.20,
}

// Limite de isenção mensal (em BRL de vendas totais)
const EXEMPTION_LIMIT: Partial<Record<AssetType, number>> = {
  STOCK_BR: 20_000,
  CRYPTO:   35_000,
}

interface AssetSummary {
  assetType: AssetType
  ticker: string
  name: string
  soldQty: number
  avgCostAtSale: number
  totalSold: number   // receita bruta das vendas
  costBasis: number   // custo médio × qtd vendida
  grossProfit: number // totalSold - costBasis - fees
  fees: number
  isExempt: boolean
  taxRate: number
  taxDue: number
}

interface IRReport {
  month: string
  totalSold: number
  totalGrossProfit: number
  totalTaxDue: number
  byAsset: AssetSummary[]
  byType: Record<string, {
    totalSold: number
    grossProfit: number
    taxDue: number
    isExempt: boolean
  }>
}

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const monthParam = searchParams.get('month') // format: "2024-01"

  let startDate: Date
  let endDate: Date

  if (monthParam && /^\d{4}-\d{2}$/.test(monthParam)) {
    const [year, month] = monthParam.split('-').map(Number)
    startDate = new Date(Date.UTC(year, month - 1, 1))
    endDate   = new Date(Date.UTC(year, month, 1))
  } else {
    // Default: mês corrente
    const now = new Date()
    startDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
    endDate   = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))
  }

  // Busca todas as vendas do mês
  const sells = await prisma.trade.findMany({
    where: {
      userId: session.user.id,
      type: 'SELL',
      date: { gte: startDate, lt: endDate },
    },
    include: { asset: true },
    orderBy: { date: 'asc' },
  })

  if (sells.length === 0) {
    return NextResponse.json({
      month: monthParam ?? startDate.toISOString().slice(0, 7),
      totalSold: 0,
      totalGrossProfit: 0,
      totalTaxDue: 0,
      byAsset: [],
      byType: {},
    } satisfies IRReport)
  }

  // Para cada ativo vendido, calcula custo médio usando todos os trades anteriores à data da venda
  const assetIds = [...new Set(sells.map(s => s.assetId))]

  const summaries: AssetSummary[] = []

  for (const assetId of assetIds) {
    const assetSells = sells.filter(s => s.assetId === assetId)
    const asset = assetSells[0].asset

    // Busca todos os trades do ativo anteriores ao fim do mês
    const allTrades = await prisma.trade.findMany({
      where: { userId: session.user.id, assetId, date: { lt: endDate } },
      orderBy: { date: 'asc' },
    })

    // Recalcula custo médio sequencialmente para capturar o CM no momento de cada venda
    let totalQty = 0
    let totalCost = 0
    let totalSoldValue = 0
    let totalCostBasis = 0
    let totalSoldQty = 0
    let totalFees = 0

    // Monta mapa de vendas do mês para comparação por id
    const monthSellIds = new Set(assetSells.map(s => s.id))

    for (const trade of allTrades) {
      if (trade.type === 'BUY') {
        totalCost += trade.quantity * trade.price + trade.fees
        totalQty  += trade.quantity
      } else {
        const avgPrice = totalQty > 0 ? totalCost / totalQty : 0

        if (monthSellIds.has(trade.id)) {
          totalSoldValue += trade.quantity * trade.price - trade.fees
          totalCostBasis += trade.quantity * avgPrice
          totalSoldQty   += trade.quantity
          totalFees      += trade.fees
        }

        // Reduz custo médio proporcionalmente
        if (totalQty > 0) {
          const sellRatio = trade.quantity / totalQty
          totalCost -= totalCost * sellRatio
          totalQty  -= trade.quantity
        }
      }
    }

    const grossProfit = totalSoldValue - totalCostBasis
    const totalSoldBrutto = assetSells.reduce((s, t) => s + t.total, 0)

    // Agrega vendas do mesmo tipo para calcular isenção por tipo no mês
    // (a isenção é calculada por tipo depois do loop, injetamos dados parciais por ora)
    const taxRate = TAX_RATE[asset.type as AssetType] ?? 0.15

    summaries.push({
      assetType: asset.type as AssetType,
      ticker: asset.ticker,
      name: asset.name,
      soldQty: totalSoldQty,
      avgCostAtSale: totalSoldQty > 0 ? totalCostBasis / totalSoldQty : 0,
      totalSold: totalSoldBrutto,
      costBasis: totalCostBasis,
      grossProfit,
      fees: totalFees,
      isExempt: false, // preenchido após agregar por tipo
      taxRate,
      taxDue: 0,       // preenchido após calcular isenção
    })
  }

  // Agrupa por tipo para calcular isenção (a isenção é por soma de vendas do tipo no mês)
  const byType: Record<string, { totalSold: number; grossProfit: number; taxDue: number; isExempt: boolean }> = {}

  for (const s of summaries) {
    if (!byType[s.assetType]) {
      byType[s.assetType] = { totalSold: 0, grossProfit: 0, taxDue: 0, isExempt: false }
    }
    byType[s.assetType].totalSold    += s.totalSold
    byType[s.assetType].grossProfit  += s.grossProfit
  }

  // Aplica isenção por tipo
  for (const [type, data] of Object.entries(byType)) {
    const limit = EXEMPTION_LIMIT[type as AssetType]
    const isExempt = limit !== undefined && data.totalSold <= limit
    data.isExempt = isExempt
    data.taxDue   = isExempt || data.grossProfit <= 0
      ? 0
      : data.grossProfit * (TAX_RATE[type as AssetType] ?? 0.15)
  }

  // Preenche isenção e imposto de volta nos summaries individuais
  for (const s of summaries) {
    const typeData = byType[s.assetType]
    s.isExempt = typeData.isExempt
    s.taxDue   = s.isExempt || s.grossProfit <= 0
      ? 0
      : s.grossProfit * s.taxRate
  }

  const totalSold        = summaries.reduce((a, s) => a + s.totalSold, 0)
  const totalGrossProfit = summaries.reduce((a, s) => a + s.grossProfit, 0)
  const totalTaxDue      = Object.values(byType).reduce((a, t) => a + t.taxDue, 0)

  return NextResponse.json({
    month: startDate.toISOString().slice(0, 7),
    totalSold,
    totalGrossProfit,
    totalTaxDue,
    byAsset: summaries,
    byType,
  } satisfies IRReport)
}
