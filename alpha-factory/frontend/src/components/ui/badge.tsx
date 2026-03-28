import { cn } from '@/lib/utils'

type BadgeVariant = 'default' | 'success' | 'danger' | 'warning' | 'info'

interface BadgeProps {
  variant?: BadgeVariant
  className?: string
  children: React.ReactNode
}

const variantClasses: Record<BadgeVariant, string> = {
  default: 'bg-white/10 text-white/70',
  success: 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30',
  danger: 'bg-red-500/20 text-red-400 border border-red-500/30',
  warning: 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30',
  info: 'bg-blue-500/20 text-blue-400 border border-blue-500/30',
}

export function Badge({ variant = 'default', className, children }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold',
        variantClasses[variant],
        className
      )}
    >
      {children}
    </span>
  )
}
