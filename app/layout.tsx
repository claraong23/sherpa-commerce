import type { Metadata, Viewport } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import './globals.css'

/*
 * Self-hosted by next/font at build time, so there is no render-blocking
 * request to a font CDN and no layout shift. Geist is a grotesk with real
 * tabular figures, which the offer tables and price rows depend on.
 */
const sans = Geist({
  subsets: ['latin'],
  variable: '--font-geist-sans',
  display: 'swap',
})

const mono = Geist_Mono({
  subsets: ['latin'],
  variable: '--font-geist-mono',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'Sherpa · Agentic commerce infrastructure',
  description:
    'Turn any merchant into an AI-native seller through one conversation. That merchant\u2019s agent can then autonomously compete for customer intent.',
}

export const viewport: Viewport = {
  themeColor: '#fbfcfe',
  width: 'device-width',
  initialScale: 1,
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body className="min-h-full antialiased">{children}</body>
    </html>
  )
}
