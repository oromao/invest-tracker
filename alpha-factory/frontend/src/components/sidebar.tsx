'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState } from 'react'
import { cn } from '@/lib/utils'

const navItems = [
  {
    href: '/signals',
    label: 'Signals',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <path d="M3 9h18M9 21V9" />
        <path d="M7 15h2M7 19h2M13 13h4M13 17h4M13 21h4" />
      </svg>
    ),
  },
  {
    href: '/regimes',
    label: 'Regimes',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
        <circle cx="12" cy="12" r="10" />
        <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
      </svg>
    ),
  },
  {
    href: '/backtests',
    label: 'Backtests',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
      </svg>
    ),
  },
  {
    href: '/research',
    label: 'Research Lab',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
        <path d="M9 3H5a2 2 0 0 0-2 2v4m6-6h10a2 2 0 0 1 2 2v4M9 3v18m0 0h10a2 2 0 0 0 2-2V9M9 21H5a2 2 0 0 1-2-2V9m0 0h18" />
        <path d="M9 9h6M9 13h4" />
      </svg>
    ),
  },
  {
    href: '/portfolio',
    label: 'Portfolio',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
        <rect x="2" y="7" width="20" height="14" rx="2" />
        <path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2" />
      </svg>
    ),
  },
]

export function Sidebar() {
  const pathname = usePathname()
  const [isOpen, setIsOpen] = useState(false)

  return (
    <>
      {/* Mobile hamburger button */}
      <button
        className="md:hidden fixed top-4 left-4 z-[60] p-2 rounded-lg bg-[#0d0d0d] border border-white/10 text-white/70 hover:text-white"
        onClick={() => setIsOpen(!isOpen)}
        aria-label="Toggle navigation"
      >
        {isOpen ? (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="18" x2="21" y2="18" />
          </svg>
        )}
      </button>

      {/* Mobile overlay */}
      {isOpen && (
        <div
          className="md:hidden fixed inset-0 z-[55] bg-black/60 backdrop-blur-sm"
          onClick={() => setIsOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          'fixed left-0 top-0 h-full w-56 bg-[#0d0d0d] border-r border-white/8 flex flex-col z-[56] transition-transform duration-200',
          // On mobile: hidden by default, slide in when open
          isOpen ? 'translate-x-0' : '-translate-x-full',
          // On desktop: always visible
          'md:translate-x-0'
        )}
      >
        {/* Logo */}
        <div className="px-5 py-5 border-b border-white/8">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-blue-500/20 flex items-center justify-center flex-shrink-0">
              <svg viewBox="0 0 24 24" fill="none" stroke="#3b82f6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
                <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
              </svg>
            </div>
            <div>
              <div className="text-sm font-bold text-white leading-tight">Alpha Factory</div>
              <div className="text-[10px] text-white/40 leading-tight">Signal Engine</div>
            </div>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-4 space-y-0.5">
          {navItems.map((item) => {
            const isActive = pathname === item.href || pathname.startsWith(item.href + '/')
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setIsOpen(false)}
                className={cn(
                  'flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-all',
                  isActive
                    ? 'bg-blue-500/15 text-blue-400 font-medium'
                    : 'text-white/50 hover:text-white/80 hover:bg-white/5'
                )}
              >
                <span className={cn(isActive ? 'text-blue-400' : 'text-white/40')}>
                  {item.icon}
                </span>
                {item.label}
              </Link>
            )
          })}
        </nav>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-white/8">
          <p className="text-[11px] text-white/30">Alpha Factory v0.1</p>
        </div>
      </aside>
    </>
  )
}
