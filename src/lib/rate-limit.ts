import { Ratelimit } from '@upstash/ratelimit'
import { redis } from './cache'
import { NextRequest } from 'next/server'

// 5 login attempts per 15 minutes per IP
export const loginRateLimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(5, '15 m'),
  analytics: true,
  prefix: 'rl:login',
})

// 30 quote requests per minute per IP
export const quoteRateLimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(30, '1 m'),
  analytics: true,
  prefix: 'rl:quotes',
})

export function getIP(req: NextRequest): string {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    req.headers.get('x-real-ip') ??
    '127.0.0.1'
  )
}
