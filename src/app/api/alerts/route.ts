/**
 * GET  /api/alerts  — lista alertas do usuário
 * POST /api/alerts  — cria novo alerta
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

const createSchema = z.object({
  assetId:     z.string().min(1),
  type:        z.enum(['PRICE', 'PERCENT']),
  targetPrice: z.number().positive(),
  direction:   z.enum(['ABOVE', 'BELOW']),
})

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const alerts = await prisma.alert.findMany({
    where: { userId: session.user.id },
    include: { asset: true },
    orderBy: [{ active: 'desc' }, { createdAt: 'desc' }],
  })

  return NextResponse.json(alerts)
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => null)
  const parsed = createSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })

  const { assetId, type, targetPrice, direction } = parsed.data

  const asset = await prisma.asset.findUnique({ where: { id: assetId } })
  if (!asset) return NextResponse.json({ error: 'Ativo não encontrado' }, { status: 404 })

  const alert = await prisma.alert.create({
    data: { userId: session.user.id, assetId, type, targetPrice, direction },
    include: { asset: true },
  })

  return NextResponse.json(alert, { status: 201 })
}
