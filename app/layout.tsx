import type { Metadata } from 'next'
import { Bebas_Neue, Inter, Roboto_Mono } from 'next/font/google'
import './globals.css'

const condensed = Bebas_Neue({ subsets: ['latin'], weight: ['400'], variable: '--font-condensed' })
const inter = Inter({ subsets: ['latin'], weight: ['400', '500'], variable: '--font-inter' })
const mono = Roboto_Mono({ subsets: ['latin'], weight: ['400'], variable: '--font-mono' })

export const metadata: Metadata = {
  title: 'AI FOR BUSINESS — DRISHTI VISION',
  description: 'AI-powered examination monitoring through advanced motion analysis and behavioral pattern detection',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${condensed.variable} ${inter.variable} ${mono.variable}`}>
      <body className="bg-background text-foreground font-sans antialiased">{children}</body>
    </html>
  )
}
