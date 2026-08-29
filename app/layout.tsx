import type { Metadata, Viewport } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Agentic Commerce — Visa Hackathon Prototype',
  description:
    'Turn any merchant into an AI-native seller through one conversation. That merchant\u2019s agent can then autonomously compete for customer intent.',
}

export const viewport: Viewport = {
  themeColor: '#05070d',
  width: 'device-width',
  initialScale: 1,
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-full antialiased">{children}</body>
    </html>
  )
}
