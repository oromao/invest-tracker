'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })

const ASSET_TYPE_NAMES: Record<string, string> = {
  STOCK_BR: 'Ação BR',
  STOCK_US: 'Ação US',
  FII: 'FII',
  CRYPTO: 'Crypto',
  OPTION: 'Opção',
}

interface AssetSummary {
  assetType: string
  ticker: string
  name: string
  soldQty: number
  avgCostAtSale: number
  totalSold: number
  costBasis: number
  grossProfit: number
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
  byType: Record<string, { totalSold: number; grossProfit: number; taxDue: number; isExempt: boolean }>
}

function months() {
  const result: { value: string; label: string }[] = []
  const now = new Date()
  for (let i = 0; i < 13; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const value = d.toISOString().slice(0, 7)
    const label = d.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
    result.push({ value, label: label.charAt(0).toUpperCase() + label.slice(1) })
  }
  return result
}

function SummarySkeleton() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
      {Array.from({ length: 3 }).map((_, i) => (
        <Card key={i}><Skeleton className="h-16 w-full" /></Card>
      ))}
    </div>
  )
}

export default function IRPage() {
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7))
  const monthOptions = months()

  const { data, isLoading, error } = useQuery<IRReport>({
    queryKey: ['ir', month],
    queryFn: () => fetch(`/api/ir?month=${month}`).then(r => r.json()),
  })

  const hasSells = (data?.byAsset.length ?? 0) > 0

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-white">Relatório de IR</h1>
          <p className="text-white/50 text-sm mt-1">Ganho de capital e imposto devido por mês</p>
        </div>
        <div>
          <select
            value={month}
            onChange={e => setMonth(e.target.value)}
            className="bg-[#1a1a1a] border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500 transition-colors"
          >
            {monthOptions.map(m => (
              <option key={m.value} value={m.value}>{m.label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Disclaimer */}
      <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-xl px-4 py-3 text-xs text-yellow-300/80">
        <strong>Aviso:</strong> Este relatório é uma estimativa baseada nos seus registros. Consulte um contador para declaração oficial.
        Alíquotas: Ações BR 15% (isento &lt; R$20k/mês) · FII 20% · Crypto 15% (isento &lt; R$35k/mês) · Ações US 15% · Opções 20%
      </div>

      {isLoading ? (
        <SummarySkeleton />
      ) : error ? (
        <div className="py-12 text-center text-red-400 text-sm">Erro ao carregar relatório.</div>
      ) : !hasSells ? (
        <div className="py-16 text-center text-white/40">
          <p className="text-sm">Nenhuma venda registrada em {monthOptions.find(m => m.value === month)?.label}.</p>
        </div>
      ) : (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Card>
              <p className="text-xs text-white/50 mb-1">Total em Vendas</p>
              <p className="text-xl font-bold text-white">{BRL.format(data!.totalSold)}</p>
              <p className="text-xs text-white/40 mt-1">Receita bruta das alienações</p>
            </Card>
            <Card>
              <p className="text-xs text-white/50 mb-1">Lucro Bruto</p>
              <p className={`text-xl font-bold ${data!.totalGrossProfit >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                {data!.totalGrossProfit >= 0 ? '+' : ''}{BRL.format(data!.totalGrossProfit)}
              </p>
              <p className="text-xs text-white/40 mt-1">Receita − custo médio − taxas</p>
            </Card>
            <Card>
              <p className="text-xs text-white/50 mb-1">Imposto Estimado (DARF)</p>
              <p className={`text-xl font-bold ${data!.totalTaxDue > 0 ? 'text-red-400' : 'text-white'}`}>
                {BRL.format(data!.totalTaxDue)}
              </p>
              <p className="text-xs text-white/40 mt-1">Vence último dia útil do mês seguinte</p>
            </Card>
          </div>

          {/* By type breakdown */}
          {Object.keys(data!.byType).length > 0 && (
            <Card className="p-0 overflow-hidden">
              <div className="px-4 py-3 border-b border-white/10">
                <h2 className="text-sm font-semibold text-white">Resumo por Categoria</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-white/40 border-b border-white/10 bg-white/[0.02]">
                      <th className="text-left px-4 py-3 font-medium">Categoria</th>
                      <th className="text-right px-4 py-3 font-medium">Total Vendas</th>
                      <th className="text-right px-4 py-3 font-medium">Lucro Bruto</th>
                      <th className="text-center px-4 py-3 font-medium">Isenção</th>
                      <th className="text-right px-4 py-3 font-medium">Imposto</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(data!.byType).map(([type, t]) => (
                      <tr key={type} className="border-b border-white/5 last:border-0">
                        <td className="px-4 py-3 font-medium text-white">{ASSET_TYPE_NAMES[type] ?? type}</td>
                        <td className="px-4 py-3 text-right text-white/80">{BRL.format(t.totalSold)}</td>
                        <td className="px-4 py-3 text-right">
                          <span className={t.grossProfit >= 0 ? 'text-green-400' : 'text-red-400'}>
                            {t.grossProfit >= 0 ? '+' : ''}{BRL.format(t.grossProfit)}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-center">
                          {t.isExempt
                            ? <Badge variant="success">Isento</Badge>
                            : <Badge variant="danger">Não isento</Badge>}
                        </td>
                        <td className="px-4 py-3 text-right font-medium">
                          <span className={t.taxDue > 0 ? 'text-red-400' : 'text-white/60'}>
                            {BRL.format(t.taxDue)}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          {/* By asset detail */}
          <Card className="p-0 overflow-hidden">
            <div className="px-4 py-3 border-b border-white/10">
              <h2 className="text-sm font-semibold text-white">Detalhe por Ativo</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-white/40 border-b border-white/10 bg-white/[0.02]">
                    <th className="text-left px-4 py-3 font-medium">Ativo</th>
                    <th className="text-right px-4 py-3 font-medium">Qtd Vendida</th>
                    <th className="text-right px-4 py-3 font-medium">Custo Médio</th>
                    <th className="text-right px-4 py-3 font-medium">Receita</th>
                    <th className="text-right px-4 py-3 font-medium">Lucro Bruto</th>
                    <th className="text-right px-4 py-3 font-medium">Imposto</th>
                  </tr>
                </thead>
                <tbody>
                  {data!.byAsset.map((s, i) => (
                    <tr key={i} className="border-b border-white/5 last:border-0 hover:bg-white/[0.02]">
                      <td className="px-4 py-3">
                        <p className="font-semibold text-white">{s.ticker}</p>
                        <p className="text-xs text-white/40">{ASSET_TYPE_NAMES[s.assetType] ?? s.assetType}</p>
                      </td>
                      <td className="px-4 py-3 text-right text-white/80">
                        {s.soldQty.toLocaleString('pt-BR', { maximumFractionDigits: 8 })}
                      </td>
                      <td className="px-4 py-3 text-right text-white/80">
                        {BRL.format(s.avgCostAtSale)}
                      </td>
                      <td className="px-4 py-3 text-right text-white/80">
                        {BRL.format(s.totalSold)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className={s.grossProfit >= 0 ? 'text-green-400' : 'text-red-400'}>
                          {s.grossProfit >= 0 ? '+' : ''}{BRL.format(s.grossProfit)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        {s.isExempt ? (
                          <span className="text-green-400 text-xs font-medium">Isento</span>
                        ) : (
                          <span className={s.taxDue > 0 ? 'text-red-400 font-medium' : 'text-white/40'}>
                            {BRL.format(s.taxDue)}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {data!.totalTaxDue > 0 && (
            <div className="bg-red-500/10 border border-red-500/20 rounded-xl px-5 py-4">
              <p className="text-sm font-semibold text-red-300 mb-1">DARF a Recolher</p>
              <p className="text-2xl font-bold text-red-400">{BRL.format(data!.totalTaxDue)}</p>
              <p className="text-xs text-red-300/70 mt-2">
                Código DARF: Ações/FII = 6015 · Crypto = 8523 · Exterior = 0473 ·
                Vencimento: último dia útil do mês subsequente às vendas.
              </p>
            </div>
          )}
        </>
      )}
    </div>
  )
}
