import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import SidebarClient from './SidebarClient'

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const session = await auth()
  if (!session?.user) {
    redirect('/login')
  }

  return (
    <div className="min-h-screen bg-[#0a0a0a] flex">
      <SidebarClient user={session.user} />
      {/* Main content - offset for desktop sidebar */}
      <main className="flex-1 min-w-0 md:ml-60 pb-16 md:pb-0">
        <div className="px-4 py-6 md:px-8 max-w-7xl mx-auto">{children}</div>
      </main>
    </div>
  )
}
