export function Card({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={`bg-[#111] border border-white/10 rounded-xl p-4 ${className ?? ''}`}>
      {children}
    </div>
  )
}
