import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params

  const trade = await prisma.trade.findUnique({ where: { id } })
  if (!trade) {
    return NextResponse.json({ error: 'Trade não encontrado' }, { status: 404 })
  }
  if (trade.userId !== session.user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  await prisma.trade.delete({ where: { id } })

  return new NextResponse(null, { status: 204 })
}
