'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Modal } from '@/components/ui/modal'

interface Asset {
  id: string
  ticker: string
  name: string
  type: string
}

interface Trade {
  id: string
  assetId: string
  asset: Asset
  type: 'BUY' | 'SELL'
  quantity: number
  price: number
  fees: number
  total: number
  date: string
  broker: string | null
  notes: string | null
  createdAt: string
}

interface TradesResponse {
  trades: Trade[]
  pagination: {
    page: number
    limit: number
    total: number
    pages: number
  }
}

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })

const ASSET_TYPE_NAMES: Record<string, string> = {
  STOCK_BR: 'Ação BR',
  STOCK_US: 'Ação US',
  FII: 'FII',
  CRYPTO: 'Crypto',
  OPTION: 'Opção',
}

const ASSET_TYPES = [
  { value: 'STOCK_BR', label: 'Ação BR' },
  { value: 'STOCK_US', label: 'Ação US' },
  { value: 'FII', label: 'FII' },
  { value: 'CRYPTO', label: 'Crypto' },
  { value: 'OPTION', label: 'Opção' },
]

interface TradeFormData {
  ticker: string
  assetName: string
  assetType: string
  type: 'BUY' | 'SELL'
  quantity: string
  price: string
  fees: string
  date: string
  broker: string
  notes: string
}

const initialForm: TradeFormData = {
  ticker: '',
  assetName: '',
  assetType: 'STOCK_BR',
  type: 'BUY',
  quantity: '',
  price: '',
  fees: '0',
  date: new Date().toISOString().slice(0, 10),
  broker: '',
  notes: '',
}

function FormField({
  label,
  error,
  children,
}: {
  label: string
  error?: string
  children: React.ReactNode
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-white/70 mb-1">{label}</label>
      {children}
      {error && <p className="mt-1 text-xs text-red-400">{error}</p>}
    </div>
  )
}

const inputClass =
  'w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white placeholder-white/30 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50 transition-all text-sm'

export default function TradesPage() {
  const [page, setPage] = useState(1)
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState<TradeFormData>(initialForm)
  const [formError, setFormError] = useState<string | null>(null)
  const queryClient = useQueryClient()

  const { data, isLoading } = useQuery<TradesResponse>({
    queryKey: ['trades', page],
    queryFn: () => fetch(`/api/trades?page=${page}`).then((r) => r.json()),
  })

  const createTrade = useMutation({
    mutationFn: async (formData: TradeFormData) => {
      // Step 1: ensure asset exists
      const assetRes = await fetch('/api/assets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ticker: formData.ticker.toUpperCase(),
          name: formData.assetName || formData.ticker.toUpperCase(),
          type: formData.assetType,
          currency: formData.assetType === 'STOCK_US' ? 'USD' : 'BRL',
        }),
      })

      if (!assetRes.ok) {
        const err = await assetRes.json()
        throw new Error(err?.error?.fieldErrors
          ? Object.values(err.error.fieldErrors).flat().join(', ')
          : 'Erro ao criar ativo')
      }

      const asset = await assetRes.json()

      // Step 2: create trade
      const tradeRes = await fetch('/api/trades', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          assetId: asset.id,
          type: formData.type,
          quantity: parseFloat(formData.quantity),
          price: parseFloat(formData.price),
          fees: parseFloat(formData.fees) || 0,
          date: new Date(formData.date).toISOString(),
          broker: formData.broker || undefined,
          notes: formData.notes || undefined,
        }),
      })

      if (!tradeRes.ok) {
        const err = await tradeRes.json()
        throw new Error(err?.error?.fieldErrors
          ? Object.values(err.error.fieldErrors).flat().join(', ')
          : 'Erro ao criar operação')
      }

      return tradeRes.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['trades'] })
      queryClient.invalidateQueries({ queryKey: ['portfolio'] })
      setShowModal(false)
      setForm(initialForm)
      setFormError(null)
    },
    onError: (err: Error) => {
      setFormError(err.message)
    },
  })

  function handleFieldChange(
    field: keyof TradeFormData,
    value: string
  ) {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setFormError(null)

    if (!form.ticker.trim()) {
      setFormError('Informe o ticker do ativo.')
      return
    }
    if (!form.quantity || parseFloat(form.quantity) <= 0) {
      setFormError('Informe uma quantidade válida.')
      return
    }
    if (!form.price || parseFloat(form.price) <= 0) {
      setFormError('Informe um preço válido.')
      return
    }
    if (!form.date) {
      setFormError('Informe a data da operação.')
      return
    }

    createTrade.mutate(form)
  }

  const trades = data?.trades ?? []
  const pagination = data?.pagination

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Operações</h1>
          <p className="text-white/50 text-sm mt-1">Histórico de compras e vendas</p>
        </div>
        <button
          onClick={() => {
            setShowModal(true)
            setForm(initialForm)
            setFormError(null)
          }}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Nova Operação
        </button>
      </div>

      <Card className="p-0 overflow-hidden">
        {isLoading ? (
          <div className="p-6 space-y-3">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : trades.length === 0 ? (
          <div className="py-16 text-center text-white/40">
            <svg
              className="w-12 h-12 mx-auto mb-4 opacity-30"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4"
              />
            </svg>
            <p className="text-sm">Nenhuma operação registrada.</p>
            <p className="text-xs mt-2">
              Clique em &quot;Nova Operação&quot; para começar.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-white/40 border-b border-white/10 bg-white/[0.02]">
                  <th className="text-left px-4 py-3 font-medium">Data</th>
                  <th className="text-left px-4 py-3 font-medium">Ativo</th>
                  <th className="text-left px-4 py-3 font-medium">Tipo Op.</th>
                  <th className="text-right px-4 py-3 font-medium">Qtd</th>
                  <th className="text-right px-4 py-3 font-medium">Preço</th>
                  <th className="text-right px-4 py-3 font-medium">Taxas</th>
                  <th className="text-right px-4 py-3 font-medium">Total</th>
                  <th className="text-left px-4 py-3 font-medium">Corretora</th>
                </tr>
              </thead>
              <tbody>
                {trades.map((trade) => (
                  <tr
                    key={trade.id}
                    className="border-b border-white/5 last:border-0 hover:bg-white/[0.02] transition-colors"
                  >
                    <td className="px-4 py-3 text-white/70 whitespace-nowrap">
                      {format(new Date(trade.date), 'dd/MM/yyyy', { locale: ptBR })}
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-semibold text-white">{trade.asset.ticker}</p>
                      <p className="text-xs text-white/40">
                        {ASSET_TYPE_NAMES[trade.asset.type] ?? trade.asset.type}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={trade.type === 'BUY' ? 'success' : 'danger'}>
                        {trade.type === 'BUY' ? 'COMPRA' : 'VENDA'}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-right text-white/80">
                      {trade.quantity.toLocaleString('pt-BR', { maximumFractionDigits: 8 })}
                    </td>
                    <td className="px-4 py-3 text-right text-white/80">
                      {BRL.format(trade.price)}
                    </td>
                    <td className="px-4 py-3 text-right text-white/60">
                      {BRL.format(trade.fees)}
                    </td>
                    <td className="px-4 py-3 text-right font-medium text-white">
                      {BRL.format(trade.total)}
                    </td>
                    <td className="px-4 py-3 text-white/60 text-xs">
                      {trade.broker ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Pagination */}
      {pagination && pagination.pages > 1 && (
        <div className="flex items-center justify-between text-sm">
          <p className="text-white/40">
            Mostrando {(page - 1) * pagination.limit + 1}–
            {Math.min(page * pagination.limit, pagination.total)} de {pagination.total} operações
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="px-3 py-1.5 rounded-lg bg-white/5 text-white/60 hover:text-white hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
            >
              Anterior
            </button>
            <span className="px-3 py-1.5 text-white/60">
              {page} / {pagination.pages}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(pagination.pages, p + 1))}
              disabled={page === pagination.pages}
              className="px-3 py-1.5 rounded-lg bg-white/5 text-white/60 hover:text-white hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
            >
              Próxima
            </button>
          </div>
        </div>
      )}

      {/* Nova Operação Modal */}
      <Modal
        open={showModal}
        onClose={() => {
          setShowModal(false)
          setFormError(null)
        }}
        title="Nova Operação"
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <FormField label="Ticker *">
              <input
                type="text"
                value={form.ticker}
                onChange={(e) => handleFieldChange('ticker', e.target.value.toUpperCase())}
                placeholder="ex: PETR4, BTC"
                className={inputClass}
                required
              />
            </FormField>
            <FormField label="Tipo de Ativo *">
              <select
                value={form.assetType}
                onChange={(e) => handleFieldChange('assetType', e.target.value)}
                className={inputClass}
              >
                {ASSET_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </FormField>
          </div>

          <FormField label="Nome do Ativo">
            <input
              type="text"
              value={form.assetName}
              onChange={(e) => handleFieldChange('assetName', e.target.value)}
              placeholder="ex: Petrobras PN, Bitcoin (opcional)"
              className={inputClass}
            />
          </FormField>

          <div className="grid grid-cols-2 gap-4">
            <FormField label="Operação *">
              <select
                value={form.type}
                onChange={(e) => handleFieldChange('type', e.target.value as 'BUY' | 'SELL')}
                className={inputClass}
              >
                <option value="BUY">COMPRA</option>
                <option value="SELL">VENDA</option>
              </select>
            </FormField>
            <FormField label="Data *">
              <input
                type="date"
                value={form.date}
                onChange={(e) => handleFieldChange('date', e.target.value)}
                className={inputClass}
                required
              />
            </FormField>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <FormField label="Quantidade *">
              <input
                type="number"
                value={form.quantity}
                onChange={(e) => handleFieldChange('quantity', e.target.value)}
                placeholder="0"
                min="0"
                step="any"
                className={inputClass}
                required
              />
            </FormField>
            <FormField label="Preço Unitário (R$) *">
              <input
                type="number"
                value={form.price}
                onChange={(e) => handleFieldChange('price', e.target.value)}
                placeholder="0,00"
                min="0"
                step="any"
                className={inputClass}
                required
              />
            </FormField>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <FormField label="Taxas / Corretagem (R$)">
              <input
                type="number"
                value={form.fees}
                onChange={(e) => handleFieldChange('fees', e.target.value)}
                placeholder="0,00"
                min="0"
                step="any"
                className={inputClass}
              />
            </FormField>
            <FormField label="Corretora">
              <input
                type="text"
                value={form.broker}
                onChange={(e) => handleFieldChange('broker', e.target.value)}
                placeholder="ex: XP, Clear, Binance"
                className={inputClass}
              />
            </FormField>
          </div>

          <FormField label="Observações">
            <textarea
              value={form.notes}
              onChange={(e) => handleFieldChange('notes', e.target.value)}
              placeholder="Opcional..."
              rows={2}
              className={`${inputClass} resize-none`}
            />
          </FormField>

          {/* Preview total */}
          {form.quantity && form.price && (
            <div className="bg-white/5 rounded-lg px-4 py-3 text-sm">
              <span className="text-white/50">Total estimado: </span>
              <span className="font-semibold text-white">
                {BRL.format(
                  parseFloat(form.quantity || '0') * parseFloat(form.price || '0') +
                    parseFloat(form.fees || '0')
                )}
              </span>
            </div>
          )}

          {formError && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2.5">
              <p className="text-red-400 text-sm">{formError}</p>
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={() => {
                setShowModal(false)
                setFormError(null)
              }}
              className="flex-1 px-4 py-2 rounded-lg bg-white/5 text-white/70 hover:text-white hover:bg-white/10 transition-all text-sm font-medium"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={createTrade.isPending}
              className="flex-1 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:bg-blue-600/50 disabled:cursor-not-allowed text-white text-sm font-medium transition-all"
            >
              {createTrade.isPending ? 'Salvando...' : 'Salvar Operação'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
