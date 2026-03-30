import { type HTMLAttributes, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  className?: string
  children: ReactNode
}

export function Card({ className, children, ...props }: CardProps) {
  return (
    <div
      {...props}
      className={cn(
        'rounded-[1.35rem] border border-white/10 bg-[#111111] p-4',
        className
      )}
    >
      {children}
    </div>
  )
}

export function CardHeader({ className, children, ...props }: CardProps) {
  return (
    <div {...props} className={cn('mb-3', className)}>
      {children}
    </div>
  )
}

export function CardTitle({ className, children, ...props }: CardProps) {
  return (
    <h3 {...props} className={cn('text-sm font-semibold uppercase tracking-wider text-white/60', className)}>
      {children}
    </h3>
  )
}

export function CardValue({ className, children, ...props }: CardProps) {
  return (
    <div {...props} className={cn('mt-1 text-2xl font-bold text-white', className)}>
      {children}
    </div>
  )
}
