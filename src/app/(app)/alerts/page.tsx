'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Modal } from '@/components/ui/modal'

interface AlertAsset {
  id: string
  ticker: string
  name: string
  type: string
}

interface Alert {
  id: string
  type: 'PRICE' | 'PERCENT'
  targetPrice: number
  direction: 'ABOVE' | 'BELOW'
  active: boolean
  triggered: boolean
  triggeredAt: string | null
  createdAt: string
  asset: AlertAsset
}

interface PortfolioAsset {
  asset: AlertAsset
}

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })

function TableSkeleton() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 4 }).map((_, i) => (
        <Skeleton key={i} className="h-14 w-full rounded-lg" />
      ))}
    </div>
  )
}

function CreateAlertModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient()
  const [assetId, setAssetId] = useState('')
  const [type, setType] = useState<'PRICE' | 'PERCENT'>('PRICE')
  const [direction, setDirection] = useState<'ABOVE' | 'BELOW'>('ABOVE')
  const [targetPrice, setTargetPrice] = useState('')
  const [error, setError] = useState('')

  const { data: portfolio } = useQuery<{ positions: PortfolioAsset[] }>({
    queryKey: ['portfolio'],
    queryFn: () => fetch('/api/portfolio').then(r => r.json()),
  })

  const assets = portfolio?.positions?.map(p => p.asset) ?? []

  const mutation = useMutation({
    mutationFn: () =>
      fetch('/api/alerts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assetId, type, direction, targetPrice: parseFloat(targetPrice) }),
      }).then(async r => {
        const d = await r.json()
        if (!r.ok) throw new Error(d.error ?? 'Erro ao criar alerta')
        return d
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['alerts'] })
      onClose()
      setAssetId('')
      setTargetPrice('')
      setError('')
    },
    onError: (e: Error) => setError(e.message),
  })

  const inputCls = 'w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-blue-500 transition-colors'
  const selectCls = 'w-full bg-[#1a1a1a] border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500 transition-colors'
  const lbl = (t: string) => <label className="block text-xs text-white/50 mb-1">{t}</label>

  return (
    <Modal open={open} onClose={onClose} title="Novo Alerta">
      <div className="space-y-4">
        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-3 text-sm text-red-400">{error}</div>
        )}

        <div>
          {lbl('Ativo *')}
          <select className={selectCls} value={assetId} onChange={e => setAssetId(e.target.value)}>
            <option value="">Selecione um ativo</option>
            {assets.map(a => (
              <option key={a.id} value={a.id}>{a.ticker} — {a.name}</option>
            ))}
          </select>
          {assets.length === 0 && (
            <p className="text-xs text-white/40 mt-1">Registre operações primeiro para ver seus ativos.</p>
          )}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            {lbl('Tipo')}
            <select className={selectCls} value={type} onChange={e => setType(e.target.value as 'PRICE' | 'PERCENT')}>
              <option value="PRICE">Preço (R$)</option>
              <option value="PERCENT">Variação (%)</option>
            </select>
          </div>
          <div>
            {lbl('Direção')}
            <select className={selectCls} value={direction} onChange={e => setDirection(e.target.value as 'ABOVE' | 'BELOW')}>
              <option value="ABOVE">Acima de</option>
              <option value="BELOW">Abaixo de</option>
            </select>
          </div>
        </div>

        <div>
          {lbl(type === 'PRICE' ? 'Preço Alvo (R$) *' : 'Variação Alvo (%) *')}
          <input
            type="number" className={inputCls} min="0" step="any"
            placeholder={type === 'PRICE' ? 'ex: 350000' : 'ex: 5'}
            value={targetPrice}
            onChange={e => setTargetPrice(e.target.value)}
          />
        </div>

        {assetId && targetPrice && (
          <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg px-4 py-2.5 text-sm text-blue-300">
            Alertar quando <strong>{assets.find(a => a.id === assetId)?.ticker}</strong>{' '}
            {direction === 'ABOVE' ? 'subir acima de' : 'cair abaixo de'}{' '}
            {type === 'PRICE' ? BRL.format(parseFloat(targetPrice)) : `${targetPrice}%`}
          </div>
        )}

        <div className="flex gap-3 pt-2">
          <button onClick={onClose} className="flex-1 px-4 py-2 rounded-lg border border-white/10 text-sm text-white/60 hover:text-white hover:bg-white/5 transition-colors">
            Cancelar
          </button>
          <button
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending || !assetId || !targetPrice}
            className="flex-1 px-4 py-2 rounded-lg bg-blue-600 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {mutation.isPending ? 'Criando...' : 'Criar Alerta'}
          </button>
        </div>
      </div>
    </Modal>
  )
}

export default function AlertsPage() {
  const [modalOpen, setModalOpen] = useState(false)
  const queryClient = useQueryClient()

  const { data: alerts = [], isLoading } = useQuery<Alert[]>({
    queryKey: ['alerts'],
    queryFn: () => fetch('/api/alerts').then(r => r.json()),
  })

  const toggleMutation = useMutation({
    mutationFn: (id: string) =>
      fetch(`/api/alerts/${id}`, { method: 'PATCH' }).then(r => r.json()),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['alerts'] }),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      fetch(`/api/alerts/${id}`, { method: 'DELETE' }).then(r => r.json()),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['alerts'] }),
  })

  const active   = alerts.filter(a => a.active && !a.triggered)
  const inactive = alerts.filter(a => !a.active || a.triggered)

  const dirLabel = (a: Alert) =>
    `${a.direction === 'ABOVE' ? '↑ acima de' : '↓ abaixo de'} ${
      a.type === 'PRICE' ? BRL.format(a.targetPrice) : `${a.targetPrice}%`
    }`

  const AlertRow = ({ alert }: { alert: Alert }) => (
    <tr className="border-b border-white/5 last:border-0 hover:bg-white/[0.02] transition-colors">
      <td className="px-4 py-3">
        <p className="font-semibold text-white">{alert.asset.ticker}</p>
        <p className="text-xs text-white/40 truncate max-w-[140px]">{alert.asset.name}</p>
      </td>
      <td className="px-4 py-3">
        <Badge variant="default">{alert.type === 'PRICE' ? 'Preço' : 'Variação'}</Badge>
      </td>
      <td className="px-4 py-3 text-sm text-white/70">{dirLabel(alert)}</td>
      <td className="px-4 py-3">
        {alert.triggered ? (
          <Badge variant="warning">Disparado</Badge>
        ) : alert.active ? (
          <Badge variant="success">Ativo</Badge>
        ) : (
          <Badge variant="danger">Inativo</Badge>
        )}
      </td>
      <td className="px-4 py-3 text-xs text-white/40">
        {format(new Date(alert.createdAt), 'dd/MM/yyyy', { locale: ptBR })}
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-2 justify-end">
          {!alert.triggered && (
            <button
              onClick={() => toggleMutation.mutate(alert.id)}
              disabled={toggleMutation.isPending}
              className="text-xs px-2.5 py-1 rounded border border-white/10 text-white/50 hover:text-white hover:bg-white/5 transition-colors"
            >
              {alert.active ? 'Pausar' : 'Ativar'}
            </button>
          )}
          <button
            onClick={() => deleteMutation.mutate(alert.id)}
            disabled={deleteMutation.isPending}
            className="text-xs px-2.5 py-1 rounded border border-red-500/20 text-red-400 hover:bg-red-500/10 transition-colors"
          >
            Excluir
          </button>
        </div>
      </td>
    </tr>
  )

  const AlertTable = ({ rows, title }: { rows: Alert[]; title: string }) => (
    <div>
      <h2 className="text-sm font-semibold text-white/60 mb-3 px-1">{title}</h2>
      <Card className="p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-white/40 border-b border-white/10 bg-white/[0.02]">
                <th className="text-left px-4 py-3 font-medium">Ativo</th>
                <th className="text-left px-4 py-3 font-medium">Tipo</th>
                <th className="text-left px-4 py-3 font-medium">Condição</th>
                <th className="text-left px-4 py-3 font-medium">Status</th>
                <th className="text-left px-4 py-3 font-medium">Criado</th>
                <th className="text-right px-4 py-3 font-medium">Ações</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(a => <AlertRow key={a.id} alert={a} />)}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Alertas</h1>
          <p className="text-white/50 text-sm mt-1">Monitoramento automático de preço e variação</p>
        </div>
        <button
          onClick={() => setModalOpen(true)}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors"
        >
          <span className="text-lg leading-none">+</span>
          Novo Alerta
        </button>
      </div>

      {isLoading ? (
        <Card><TableSkeleton /></Card>
      ) : alerts.length === 0 ? (
        <div className="flex flex-col items-center justify-center min-h-[320px] text-center">
          <div className="w-16 h-16 bg-blue-500/10 border border-blue-500/20 rounded-2xl flex items-center justify-center mb-4">
            <svg className="w-8 h-8 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
            </svg>
          </div>
          <p className="text-white font-medium mb-1">Nenhum alerta configurado</p>
          <p className="text-white/40 text-sm mb-4">Crie alertas para ser notificado quando seus ativos atingirem preços-alvo.</p>
          <button onClick={() => setModalOpen(true)} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded-lg transition-colors">
            Criar primeiro alerta
          </button>
        </div>
      ) : (
        <div className="space-y-6">
          {active.length > 0 && <AlertTable rows={active} title={`Ativos (${active.length})`} />}
          {inactive.length > 0 && <AlertTable rows={inactive} title={`Inativos / Disparados (${inactive.length})`} />}
        </div>
      )}

      <CreateAlertModal open={modalOpen} onClose={() => setModalOpen(false)} />
    </div>
  )
}
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Alertas</h1>
        <p className="text-white/50 text-sm mt-1">Notificações de preço e variação</p>
      </div>

      <div className="flex flex-col items-center justify-center min-h-[400px] text-center">
        <div className="w-20 h-20 bg-yellow-500/10 border border-yellow-500/20 rounded-2xl flex items-center justify-center mb-6">
          <svg
            className="w-10 h-10 text-yellow-400"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
            />
          </svg>
        </div>

        <div className="bg-[#111] border border-white/10 rounded-2xl px-8 py-6 max-w-md w-full">
          <div className="inline-flex items-center gap-2 bg-yellow-500/10 border border-yellow-500/20 text-yellow-400 text-xs font-medium px-3 py-1 rounded-full mb-4">
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            Em breve
          </div>

          <h2 className="text-xl font-bold text-white mb-3">Alertas de Preço</h2>
          <p className="text-white/50 text-sm leading-relaxed mb-6">
            Em breve você poderá configurar alertas automáticos para seus ativos.
            Seja notificado quando um ativo atingir determinado preço ou variação percentual.
          </p>

          <div className="space-y-3 text-left">
            {[
              { icon: '📈', text: 'Alerta quando ativo ultrapassar preço alvo' },
              { icon: '📉', text: 'Alerta quando ativo cair abaixo de suporte' },
              { icon: '📊', text: 'Alerta por variação percentual' },
              { icon: '🔔', text: 'Notificações em tempo real' },
            ].map((feature) => (
              <div
                key={feature.text}
                className="flex items-center gap-3 py-2 border-b border-white/5 last:border-0"
              >
                <span className="text-base">{feature.icon}</span>
                <span className="text-sm text-white/60">{feature.text}</span>
              </div>
            ))}
          </div>
        </div>

        <p className="text-white/30 text-xs mt-6">
          Esta funcionalidade está sendo desenvolvida e estará disponível em breve.
        </p>
      </div>
    </div>
  )
}
