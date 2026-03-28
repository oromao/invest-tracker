import { type ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface CardProps {
  className?: string
  children: ReactNode
}

export function Card({ className, children }: CardProps) {
  return (
    <div
      className={cn(
        'bg-[#111111] border border-white/10 rounded-xl p-4',
        className
      )}
    >
      {children}
    </div>
  )
}

export function CardHeader({ className, children }: CardProps) {
  return (
    <div className={cn('mb-3', className)}>
      {children}
    </div>
  )
}

export function CardTitle({ className, children }: CardProps) {
  return (
    <h3 className={cn('text-sm font-semibold text-white/60 uppercase tracking-wider', className)}>
      {children}
    </h3>
  )
}

export function CardValue({ className, children }: CardProps) {
  return (
    <div className={cn('text-2xl font-bold text-white mt-1', className)}>
      {children}
    </div>
  )
}
