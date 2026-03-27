# 📈 InvestTracker

Agregador de portfólio de investimentos — ações BR/US, FIIs, criptomoedas e opções — com P&L em tempo real, gestão de operações, alertas de preço e relatórios de IR.

## Stack

| Camada | Tech |
|---|---|
| Frontend | Next.js 15 + TypeScript strict |
| UI | Tailwind v4 + Shadcn/ui + Recharts |
| Backend | Next.js API Routes |
| ORM | Prisma 6 + PostgreSQL (Neon) |
| Auth | NextAuth v5 |
| Cache | Upstash Redis |
| Deploy | Vercel (região São Paulo) |

## Setup rápido

```bash
# 1. Clone
git clone https://github.com/oromao/invest-tracker
cd invest-tracker

# 2. Instale dependências
npm install

# 3. Configure variáveis
cp .env.example .env.local
# Edite .env.local com suas chaves

# 4. Inicialize banco
npm run db:push

# 5. Seed inicial (assets padrão)
npm run db:seed

# 6. Rode localmente
npm run dev
```

## APIs externas

- **CoinGecko** — cotações crypto (free, 30 req/min)
- **Yahoo Finance** — ações BR/US (unofficial, sem key)
- **Alpha Vantage** — fallback para ações (free key, 25 req/dia)

## Funcionalidades

### MVP
- [x] Schema de banco (Asset, Trade, PriceHistory, Alert)
- [x] Cálculo de P&L por Custo Médio
- [x] Black-Scholes para opções
- [x] Solver de Volatilidade Implícita
- [x] Cache Redis para cotações
- [x] Rate limiting no login
- [x] Cron jobs de atualização
- [ ] Dashboard UI
- [ ] Páginas de operações
- [ ] Relatório de IR

## Deploy (Vercel)

```bash
vercel --prod
```

Build command: `prisma db push && next build`
Região: `gru1` (São Paulo)
Crons: cotações a cada 5min + fechamento diário 18:30

## Licença

MIT — Paulo Romao
