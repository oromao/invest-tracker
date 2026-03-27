import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const SEED_ASSETS = [
  { ticker: 'PETR4', name: 'Petrobras PN', type: 'STOCK_BR' as const, currency: 'BRL', exchange: 'B3', sector: 'Energia' },
  { ticker: 'VALE3', name: 'Vale ON', type: 'STOCK_BR' as const, currency: 'BRL', exchange: 'B3', sector: 'Mineração' },
  { ticker: 'ITUB4', name: 'Itaú Unibanco PN', type: 'STOCK_BR' as const, currency: 'BRL', exchange: 'B3', sector: 'Financeiro' },
  { ticker: 'MXRF11', name: 'Maxi Renda FII', type: 'FII' as const, currency: 'BRL', exchange: 'B3' },
  { ticker: 'BTC', name: 'Bitcoin', type: 'CRYPTO' as const, currency: 'BRL' },
  { ticker: 'ETH', name: 'Ethereum', type: 'CRYPTO' as const, currency: 'BRL' },
  { ticker: 'AAPL', name: 'Apple Inc.', type: 'STOCK_US' as const, currency: 'USD', exchange: 'NASDAQ', sector: 'Tecnologia' },
]

async function main() {
  console.log('🌱 Seeding database...')

  for (const asset of SEED_ASSETS) {
    await prisma.asset.upsert({
      where: { ticker: asset.ticker },
      update: {},
      create: asset,
    })
    console.log(`  ✅ ${asset.ticker} — ${asset.name}`)
  }

  console.log('✅ Seed completo!')
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
