import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'

const createTradeSchema = z.object({
  assetId: z.string().cuid(),
  type: z.enum(['BUY', 'SELL']),
  quantity: z.number().positive(),
  price: z.number().positive(),
  fees: z.number().min(0).default(0),
  date: z.string().datetime(),
  broker: z.string().optional(),
  notes: z.string().optional(),
})

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = req.nextUrl
  const assetId = searchParams.get('assetId')
  const page = parseInt(searchParams.get('page') ?? '1')
  const limit = 20

  const trades = await prisma.trade.findMany({
    where: {
      userId: session.user.id,
      ...(assetId ? { assetId } : {}),
    },
    include: { asset: true },
    orderBy: { date: 'desc' },
    skip: (page - 1) * limit,
    take: limit,
  })

  const total = await prisma.trade.count({
    where: {
      userId: session.user.id,
      ...(assetId ? { assetId } : {}),
    },
  })

  return NextResponse.json({
    trades,
    pagination: {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit),
    },
  })
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json()
  const parsed = createTradeSchema.safeParse(body)

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }

  const { quantity, price, fees } = parsed.data
  const total = quantity * price + fees

  const trade = await prisma.trade.create({
    data: {
      ...parsed.data,
      total,
      date: new Date(parsed.data.date),
      userId: session.user.id,
    },
    include: { asset: true },
  })

  return NextResponse.json(trade, { status: 201 })
}
