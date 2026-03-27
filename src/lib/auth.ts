import NextAuth from 'next-auth'
import { PrismaAdapter } from '@auth/prisma-adapter'
import Credentials from 'next-auth/providers/credentials'
import { prisma } from './prisma'
import { loginRateLimit, getIP } from './rate-limit'
import { z } from 'zod'

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
})

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  session: { strategy: 'jwt' },
  providers: [
    Credentials({
      async authorize(credentials, req) {
        const parsed = loginSchema.safeParse(credentials)
        if (!parsed.success) return null

        // Rate limiting por IP
        const ip = req.headers?.get?.('x-forwarded-for') ?? '127.0.0.1'
        const { success } = await loginRateLimit.limit(ip)
        if (!success) throw new Error('Too many login attempts. Try again in 15 minutes.')

        const user = await prisma.user.findUnique({
          where: { email: parsed.data.email },
        })

        if (!user?.password) return null

        // Verificação de senha (use bcrypt em produção)
        const { default: bcrypt } = await import('bcryptjs')
        const valid = await bcrypt.compare(parsed.data.password, user.password)
        if (!valid) return null

        return { id: user.id, email: user.email, name: user.name }
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user) token.id = user.id
      return token
    },
    session({ session, token }) {
      if (token.id) session.user.id = token.id as string
      return session
    },
  },
  pages: {
    signIn: '/login',
  },
})
