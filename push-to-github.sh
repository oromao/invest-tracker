#!/bin/bash
# ─── Script de push inicial para o GitHub ──────────────────────────────────
# Execute este script na pasta do projeto após instalar o gh CLI

set -e

echo "🚀 InvestTracker — Push inicial para GitHub"
echo ""

# Verifica autenticação
echo "1. Verificando autenticação GitHub..."
gh auth status || {
  echo "⚠️  Não autenticado. Rode: gh auth login"
  exit 1
}

# Cria repositório
echo "2. Criando repositório..."
gh repo create oromao/invest-tracker \
  --public \
  --description "Agregador de portfólio de investimentos — ações BR/US, FIIs, crypto e opções" \
  || echo "⚠️  Repositório pode já existir, continuando..."

# Git init e primeiro commit
echo "3. Inicializando git..."
git init
git add .
git commit -m "chore: initial Next.js 15 scaffold with Prisma + Auth

- Next.js 15 App Router + TypeScript strict
- Prisma 6 + PostgreSQL schema (Asset, Trade, PriceHistory, Alert)
- NextAuth v5 com rate limiting (Upstash)
- Black-Scholes engine para opções
- Cálculo de P&L por Custo Médio
- APIs: quotes, portfolio, assets, trades, cron
- Vercel config com crons para cotações

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"

# Push
echo "4. Fazendo push..."
git branch -M main
git remote add origin https://github.com/oromao/invest-tracker.git
git push -u origin main

echo ""
echo "✅ Pronto! Repositório em: https://github.com/oromao/invest-tracker"
