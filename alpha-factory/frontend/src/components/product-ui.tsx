'use client'

import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'

type Tone = 'default' | 'success' | 'danger' | 'warning' | 'info'

export function StatusPill({
  tone = 'default',
  children,
  className,
}: {
  tone?: Tone
  children: ReactNode
  className?: string
}) {
  return (
    <Badge
      variant={tone as any}
      className={cn(
        'whitespace-nowrap rounded-full px-2.5 py-1 text-[10px] uppercase tracking-[0.18em]',
        className
      )}
    >
      {children}
    </Badge>
  )
}

export function PageHeader({
  eyebrow,
  title,
  subtitle,
  action,
  status,
}: {
  eyebrow?: string
  title: string
  subtitle: string
  action?: ReactNode
  status?: ReactNode
}) {
  return (
    <div className="flex flex-col gap-4 rounded-[1.5rem] border border-white/10 bg-[radial-gradient(circle_at_top_left,rgba(59,130,246,0.14),transparent_40%),linear-gradient(180deg,rgba(255,255,255,0.02),rgba(255,255,255,0.01))] p-5 md:p-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          {eyebrow && (
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.28em] text-blue-300/70">
              {eyebrow}
            </div>
          )}
          <h1 className="max-w-3xl text-[2rem] font-semibold tracking-tight text-white text-balance md:text-[2.4rem]">
            {title}
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-white/55 text-pretty">
            {subtitle}
          </p>
        </div>
        {(action || status) && (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center lg:justify-end">
            {status}
            {action}
          </div>
        )}
      </div>
    </div>
  )
}

export function MetricCard({
  label,
  value,
  note,
  tone = 'default',
}: {
  label: string
  value: ReactNode
  note?: ReactNode
  tone?: Tone
}) {
  const toneClasses: Record<Tone, string> = {
    default: 'text-white',
    success: 'text-emerald-400',
    danger: 'text-red-400',
    warning: 'text-yellow-400',
    info: 'text-blue-400',
  }

  return (
    <Card className="relative h-full overflow-hidden">
      <div className="absolute inset-x-0 top-0 h-px bg-white/10" />
      <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-white/38">{label}</div>
      <div className={cn('mt-2 break-words text-2xl font-semibold tabular-nums leading-tight', toneClasses[tone])}>{value}</div>
      {note && <div className="mt-2 break-words text-xs leading-5 text-white/45">{note}</div>}
    </Card>
  )
}

export function Surface({
  title,
  description,
  action,
  children,
  className,
}: {
  title: string
  description?: string
  action?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={cn('overflow-hidden rounded-[1.35rem] border border-white/10 bg-[#101010] shadow-[0_1px_0_rgba(255,255,255,0.04)]', className)}>
      <div className="flex flex-col gap-3 border-b border-white/8 px-4 py-4 md:px-5 md:py-5 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold uppercase tracking-[0.2em] text-white/80">{title}</h2>
          {description && <p className="mt-1 max-w-3xl text-sm leading-6 text-white/45">{description}</p>}
        </div>
        {action}
      </div>
      <div className="p-4 md:p-5">{children}</div>
    </section>
  )
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string
  description: string
  action?: ReactNode
}) {
  return (
    <div className="rounded-[1.25rem] border border-dashed border-white/12 bg-white/[0.02] px-5 py-10 text-center">
      <div className="mx-auto max-w-md">
        <div className="text-sm font-semibold text-white">{title}</div>
        <p className="mt-2 text-sm leading-6 text-white/45">{description}</p>
        {action && <div className="mt-4">{action}</div>}
      </div>
    </div>
  )
}

export function InlineStat({
  label,
  value,
  tone = 'default',
}: {
  label: string
  value: ReactNode
  tone?: Tone
}) {
  const toneClasses: Record<Tone, string> = {
    default: 'text-white',
    success: 'text-emerald-400',
    danger: 'text-red-400',
    warning: 'text-yellow-400',
    info: 'text-blue-400',
  }

  return (
    <div className="min-w-0 rounded-xl border border-white/8 bg-white/[0.02] px-3 py-3">
      <div className="text-[11px] uppercase tracking-[0.18em] text-white/35">{label}</div>
      <div className={cn('mt-1 break-words text-base font-semibold tabular-nums leading-5', toneClasses[tone])}>{value}</div>
    </div>
  )
}
