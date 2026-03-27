/**
 * options.ts — Black-Scholes e gregas para opções BR
 * Modelo europeu simplificado (opções BR são americanas, mas BS é boa aproximação)
 */

// Função de distribuição normal cumulativa (aproximação)
function cdf(x: number): number {
  const a1 = 0.254829592
  const a2 = -0.284496736
  const a3 = 1.421413741
  const a4 = -1.453152027
  const a5 = 1.061405429
  const p = 0.3275911

  const sign = x < 0 ? -1 : 1
  x = Math.abs(x) / Math.sqrt(2)

  const t = 1.0 / (1.0 + p * x)
  const y =
    1.0 -
    ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-x * x)

  return 0.5 * (1.0 + sign * y)
}

// Função de densidade de probabilidade normal
function pdf(x: number): number {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI)
}

export interface BlackScholesInput {
  S: number      // preço atual do ativo
  K: number      // strike da opção
  T: number      // tempo até vencimento em ANOS (ex: 30 dias = 30/252)
  r: number      // taxa livre de risco (Selic anual, ex: 0.1075 para 10.75%)
  sigma: number  // volatilidade implícita anual (ex: 0.35 para 35%)
}

export interface BlackScholesResult {
  callPrice: number
  putPrice: number
  delta: { call: number; put: number }
  gamma: number
  theta: { call: number; put: number }  // por dia
  vega: number                           // por 1% de vol
  rho: { call: number; put: number }
}

export function blackScholes(input: BlackScholesInput): BlackScholesResult {
  const { S, K, T, r, sigma } = input

  if (T <= 0) {
    // Opção vencida — valor intrínseco apenas
    const callIntrinsic = Math.max(S - K, 0)
    const putIntrinsic = Math.max(K - S, 0)
    return {
      callPrice: callIntrinsic,
      putPrice: putIntrinsic,
      delta: { call: callIntrinsic > 0 ? 1 : 0, put: putIntrinsic > 0 ? -1 : 0 },
      gamma: 0,
      theta: { call: 0, put: 0 },
      vega: 0,
      rho: { call: 0, put: 0 },
    }
  }

  const d1 =
    (Math.log(S / K) + (r + (sigma ** 2) / 2) * T) / (sigma * Math.sqrt(T))
  const d2 = d1 - sigma * Math.sqrt(T)

  const Nd1 = cdf(d1)
  const Nd2 = cdf(d2)
  const Nnd1 = cdf(-d1)
  const Nnd2 = cdf(-d2)
  const nd1 = pdf(d1)

  const discountFactor = Math.exp(-r * T)

  const callPrice = S * Nd1 - K * discountFactor * Nd2
  const putPrice = K * discountFactor * Nnd2 - S * Nnd1

  // Delta
  const deltaCall = Nd1
  const deltaPut = Nd1 - 1

  // Gamma (igual para call e put)
  const gamma = nd1 / (S * sigma * Math.sqrt(T))

  // Theta (por dia, dividindo por 252 dias úteis)
  const thetaCall =
    (-((S * nd1 * sigma) / (2 * Math.sqrt(T))) - r * K * discountFactor * Nd2) / 252
  const thetaPut =
    (-((S * nd1 * sigma) / (2 * Math.sqrt(T))) + r * K * discountFactor * Nnd2) / 252

  // Vega (por 1% de volatilidade)
  const vega = (S * nd1 * Math.sqrt(T)) / 100

  // Rho (por 1% de taxa)
  const rhoCall = (K * T * discountFactor * Nd2) / 100
  const rhoPut = (-K * T * discountFactor * Nnd2) / 100

  return {
    callPrice,
    putPrice,
    delta: { call: deltaCall, put: deltaPut },
    gamma,
    theta: { call: thetaCall, put: thetaPut },
    vega,
    rho: { call: rhoCall, put: rhoPut },
  }
}

/**
 * Solver de Volatilidade Implícita via Newton-Raphson
 * Dado o prêmio de mercado, encontra o sigma que o gera
 */
export function impliedVolatility(
  marketPrice: number,
  input: Omit<BlackScholesInput, 'sigma'>,
  type: 'CALL' | 'PUT',
  tolerance = 1e-6,
  maxIterations = 100
): number | null {
  let sigma = 0.30  // chute inicial de 30%

  for (let i = 0; i < maxIterations; i++) {
    const result = blackScholes({ ...input, sigma })
    const theoreticalPrice = type === 'CALL' ? result.callPrice : result.putPrice
    const vega = result.vega * 100  // vega por unidade de sigma

    const diff = theoreticalPrice - marketPrice
    if (Math.abs(diff) < tolerance) return sigma

    if (vega < 1e-10) return null  // vega muito pequeno, não converge

    sigma -= diff / vega

    if (sigma <= 0) sigma = 0.001  // mantém sigma positivo
    if (sigma > 5) return null     // > 500% de vol é improvável
  }

  return null  // não convergiu
}

/**
 * Converte série de opção BR para dados estruturados
 * Ex: "PETRA320" → { ticker: "PETR4", type: "CALL", strike: 320 }
 * Letras A-L = CALL (vencimento jan-dez), M-X = PUT (vencimento jan-dez)
 */
export function parseOptionSeries(series: string): {
  underlying: string
  type: 'CALL' | 'PUT'
  strike: number
  expirationMonth: number
} | null {
  const match = series.match(/^([A-Z]{4}\d?)([A-X])(\d+)$/)
  if (!match) return null

  const [, underlying, letter, strikeStr] = match
  const letterCode = letter.charCodeAt(0) - 'A'.charCodeAt(0)  // 0-23
  const type: 'CALL' | 'PUT' = letterCode < 12 ? 'CALL' : 'PUT'
  const expirationMonth = letterCode < 12 ? letterCode + 1 : letterCode - 11

  return {
    underlying,
    type,
    strike: parseFloat(strikeStr),
    expirationMonth,
  }
}
