import type { NextConfig } from 'next'
const config: NextConfig = {
  async rewrites() {
    return [{ source: '/api/:path*', destination: 'http://backend:8000/api/:path*' }]
  }
}
export default config
