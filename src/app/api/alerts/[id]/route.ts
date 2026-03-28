/**
 * DELETE /api/alerts/[id]  — remove alerta
 * PATCH  /api/alerts/[id]  — toggle ativo/inativo
 */

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const alert = await prisma.alert.findFirst({ where: { id, userId: session.user.id } })
  if (!alert) return NextResponse.json({ error: 'Alerta não encontrado' }, { status: 404 })

  await prisma.alert.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}

export async function PATCH(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const alert = await prisma.alert.findFirst({ where: { id, userId: session.user.id } })
  if (!alert) return NextResponse.json({ error: 'Alerta não encontrado' }, { status: 404 })

  const updated = await prisma.alert.update({
    where: { id },
    data: { active: !alert.active },
    include: { asset: true },
  })

  return NextResponse.json(updated)
}
