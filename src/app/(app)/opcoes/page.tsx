'use client'

import { useState, useMemo } from 'react'
import { blackScholes, impliedVolatility } from '@/lib/options'
import { Card } from '@/components/ui/card'

const FMT2 = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 4 })
const FMT4 = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 4, maximumFractionDigits: 6 })
const BRL  = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
const PCT  = (v: number) => `${(v * 100).toFixed(2)}%`

type Mode = 'pricing' | 'iv'

function GreekBar({ label, value, description, color = 'blue' }: {
  label: string; value: string; description: string; color?: string
}) {
  const colors: Record<string, string> = {
    blue: 'bg-blue-500/20 border-blue-500/30 text-blue-300',
    green: 'bg-green-500/20 border-green-500/30 text-green-300',
    yellow: 'bg-yellow-500/20 border-yellow-500/30 text-yellow-300',
    red: 'bg-red-500/20 border-red-500/30 text-red-300',
    purple: 'bg-purple-500/20 border-purple-500/30 text-purple-300',
  }
  return (
    <div className={`border rounded-xl px-4 py-3 ${colors[color]}`}>
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-bold uppercase tracking-wide opacity-70">{label}</span>
        <span className="text-lg font-bold">{value}</span>
      </div>
      <p className="text-xs opacity-60">{description}</p>
    </div>
  )
}

export default function OpcoesPage() {
  const [mode, setMode] = useState<Mode>('pricing')

  // Pricing mode inputs
  const [S, setS]         = useState('100')    // Preço do ativo
  const [K, setK]         = useState('100')    // Strike
  const [days, setDays]   = useState('30')     // Dias até vencimento
  const [r, setR]         = useState('10.75')  // Selic %
  const [sigma, setSigma] = useState('30')     // Volatilidade %

  // IV mode inputs
  const [mktPrice, setMktPrice] = useState('')
  const [optType, setOptType]   = useState<'CALL' | 'PUT'>('CALL')

  const inputCls = 'w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-blue-500 transition-colors'

  const input = (
    label: string,
    value: string,
    onChange: (v: string) => void,
    extra?: string
  ) => (
    <div>
      <label className="block text-xs text-white/50 mb-1">{label}</label>
      <div className="relative">
        <input
          type="number" min="0" step="any"
          className={inputCls + (extra ? ' pr-10' : '')}
          value={value}
          onChange={e => onChange(e.target.value)}
        />
        {extra && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-white/40">{extra}</span>
        )}
      </div>
    </div>
  )

  const bsInput = useMemo(() => ({
    S:     parseFloat(S)     || 0,
    K:     parseFloat(K)     || 0,
    T:     (parseFloat(days) || 0) / 252,
    r:     (parseFloat(r)    || 0) / 100,
    sigma: (parseFloat(sigma)|| 0) / 100,
  }), [S, K, days, r, sigma])

  const result = useMemo(() => {
    if (bsInput.S <= 0 || bsInput.K <= 0 || bsInput.T < 0 || bsInput.sigma <= 0) return null
    return blackScholes(bsInput)
  }, [bsInput])

  const ivResult = useMemo(() => {
    const mp = parseFloat(mktPrice)
    if (!mp || bsInput.S <= 0 || bsInput.K <= 0 || bsInput.T <= 0) return null
    return impliedVolatility(mp, { S: bsInput.S, K: bsInput.K, T: bsInput.T, r: bsInput.r }, optType)
  }, [mktPrice, optType, bsInput])

  const moneyness = bsInput.K > 0 && bsInput.S > 0
    ? ((bsInput.S - bsInput.K) / bsInput.K) * 100
    : null

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Calculadora de Opções</h1>
        <p className="text-white/50 text-sm mt-1">Black-Scholes com Greeks e Volatilidade Implícita</p>
      </div>

      {/* Mode selector */}
      <div className="flex gap-2">
        {[
          { v: 'pricing' as Mode, label: 'Precificação' },
          { v: 'iv' as Mode, label: 'Volatilidade Implícita' },
        ].map(m => (
          <button
            key={m.v}
            onClick={() => setMode(m.v)}
            className={`px-4 py-1.5 rounded-full text-sm font-medium transition-all ${
              mode === m.v ? 'bg-blue-600 text-white' : 'bg-white/5 text-white/60 hover:text-white hover:bg-white/10'
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Inputs */}
        <Card className="space-y-4">
          <h2 className="text-sm font-semibold text-white">Parâmetros</h2>

          <div className="grid grid-cols-2 gap-4">
            {input('Preço do Ativo (S)', S, setS, 'R$')}
            {input('Strike (K)', K, setK, 'R$')}
            {input('Dias até Vencimento', days, setDays, 'dias')}
            {input('Taxa Selic (r)', r, setR, '%a.a.')}
            {input('Volatilidade (σ)', sigma, setSigma, '%a.a.')}
          </div>

          {moneyness !== null && (
            <div className={`text-xs px-3 py-2 rounded-lg border ${
              Math.abs(moneyness) < 2
                ? 'bg-yellow-500/10 border-yellow-500/20 text-yellow-300'
                : moneyness > 0
                ? 'bg-green-500/10 border-green-500/20 text-green-300'
                : 'bg-red-500/10 border-red-500/20 text-red-300'
            }`}>
              <strong>Moneyness:</strong>{' '}
              {Math.abs(moneyness) < 2 ? 'At-the-money (ATM)' : moneyness > 0 ? 'In-the-money (ITM)' : 'Out-of-the-money (OTM)'}
              {' '}— S/K = {FMT2.format(moneyness)}%
            </div>
          )}

          {mode === 'iv' && (
            <div className="space-y-3 border-t border-white/10 pt-4">
              <h3 className="text-xs text-white/50 font-semibold uppercase tracking-wide">Volatilidade Implícita</h3>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs text-white/50 mb-1">Prêmio de Mercado (R$)</label>
                  <input
                    type="number" min="0" step="any"
                    className={inputCls}
                    value={mktPrice}
                    onChange={e => setMktPrice(e.target.value)}
                    placeholder="Ex: 3.50"
                  />
                </div>
                <div>
                  <label className="block text-xs text-white/50 mb-1">Tipo</label>
                  <select
                    className="w-full bg-[#1a1a1a] border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500 transition-colors"
                    value={optType}
                    onChange={e => setOptType(e.target.value as 'CALL' | 'PUT')}
                  >
                    <option value="CALL">CALL</option>
                    <option value="PUT">PUT</option>
                  </select>
                </div>
              </div>

              {ivResult !== null ? (
                <div className="bg-blue-500/10 border border-blue-500/20 rounded-xl px-4 py-4">
                  <p className="text-xs text-blue-300/70 mb-1">Volatilidade Implícita</p>
                  <p className="text-3xl font-bold text-blue-300">{(ivResult * 100).toFixed(2)}%</p>
                  <p className="text-xs text-blue-300/50 mt-1">a.a. (anualizada)</p>
                </div>
              ) : mktPrice ? (
                <div className="bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 text-sm text-red-400">
                  Não foi possível calcular a VI. Verifique se o prêmio é consistente com os parâmetros.
                </div>
              ) : null}
            </div>
          )}
        </Card>

        {/* Results */}
        <div className="space-y-4">
          {result ? (
            <>
              {/* Prices */}
              <div className="grid grid-cols-2 gap-4">
                <Card>
                  <p className="text-xs text-white/50 mb-1">Preço CALL</p>
                  <p className="text-2xl font-bold text-green-400">{BRL.format(result.callPrice)}</p>
                  <p className="text-xs text-white/40 mt-1">Opção de compra</p>
                </Card>
                <Card>
                  <p className="text-xs text-white/50 mb-1">Preço PUT</p>
                  <p className="text-2xl font-bold text-red-400">{BRL.format(result.putPrice)}</p>
                  <p className="text-xs text-white/40 mt-1">Opção de venda</p>
                </Card>
              </div>

              {/* Greeks */}
              <div>
                <p className="text-xs text-white/40 uppercase tracking-wide font-semibold mb-3 px-1">Greeks</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <GreekBar
                    label="Delta (Δ)"
                    value={`C: ${FMT2.format(result.delta.call)} · P: ${FMT2.format(result.delta.put)}`}
                    description="Variação do prêmio por R$1 no ativo. CALL ∈ [0,1], PUT ∈ [-1,0]."
                    color="blue"
                  />
                  <GreekBar
                    label="Gamma (Γ)"
                    value={FMT4.format(result.gamma)}
                    description="Taxa de variação do delta por R$1 no ativo. Igual para CALL e PUT."
                    color="green"
                  />
                  <GreekBar
                    label="Theta (Θ) / dia"
                    value={`C: ${FMT2.format(result.theta.call)} · P: ${FMT2.format(result.theta.put)}`}
                    description="Perda de valor por dia com o passar do tempo (decaimento temporal)."
                    color="red"
                  />
                  <GreekBar
                    label="Vega (ν) / 1% vol"
                    value={FMT4.format(result.vega)}
                    description="Variação do prêmio para cada 1% de mudança na volatilidade implícita."
                    color="purple"
                  />
                  <GreekBar
                    label="Rho (ρ) / 1% taxa"
                    value={`C: ${FMT2.format(result.rho.call)} · P: ${FMT2.format(result.rho.put)}`}
                    description="Variação do prêmio para cada 1% de mudança na taxa de juros."
                    color="yellow"
                  />
                </div>
              </div>

              {/* Info box */}
              <div className="bg-white/[0.03] border border-white/5 rounded-xl px-4 py-3 text-xs text-white/40 space-y-1">
                <p>• Modelo: <strong className="text-white/60">Black-Scholes Europeu</strong> (boa aproximação para opções americanas)</p>
                <p>• Tempo: <strong className="text-white/60">{days} dias úteis</strong> = {((parseFloat(days)||0)/252).toFixed(4)} anos</p>
                <p>• Taxa livre de risco: <strong className="text-white/60">Selic {r}% a.a.</strong></p>
                <p>• Paridade CALL-PUT: {BRL.format(result.callPrice - result.putPrice)} (deve ≈ S − Ke⁻ʳᵀ = {BRL.format(bsInput.S - bsInput.K * Math.exp(-bsInput.r * bsInput.T))})</p>
              </div>
            </>
          ) : (
            <div className="flex items-center justify-center h-64 text-white/30 text-sm border border-white/10 rounded-xl">
              Preencha os parâmetros para calcular
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
