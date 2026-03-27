import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'

const createAssetSchema = z.object({
  ticker: z.string().min(1).max(20).toUpperCase(),
  name: z.string().min(1),
  type: z.enum(['STOCK_BR', 'STOCK_US', 'FII', 'CRYPTO', 'OPTION']),
  currency: z.enum(['BRL', 'USD']).default('BRL'),
  exchange: z.string().optional(),
  sector: z.string().optional(),
})

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Retorna só assets que o usuário tem trades
  const assets = await prisma.asset.findMany({
    where: {
      trades: { some: { userId: session.user.id } },
    },
    orderBy: { ticker: 'asc' },
  })

  return NextResponse.json(assets)
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json()
  const parsed = createAssetSchema.safeParse(body)

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }

  const asset = await prisma.asset.upsert({
    where: { ticker: parsed.data.ticker },
    update: {},
    create: parsed.data,
  })

  return NextResponse.json(asset, { status: 201 })
}
