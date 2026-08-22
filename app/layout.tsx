import type { Metadata } from 'next'
import { Figtree, EB_Garamond, JetBrains_Mono } from 'next/font/google'
import './globals.css'

const figtree = Figtree({ subsets: ['latin'], variable: '--font-figtree' })
const garamond = EB_Garamond({ subsets: ['latin'], variable: '--font-garamond' })
const jetbrains = JetBrains_Mono({ subsets: ['latin'], variable: '--font-mono' })

export const metadata: Metadata = {
  title: 'DrishtiAI - Intelligent Video Analytics',
  description: 'AI-powered examination monitoring through advanced motion analysis and behavioral pattern detection',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${figtree.variable} ${garamond.variable} ${jetbrains.variable} dark`}>
      <body className="bg-background text-foreground font-sans antialiased">{children}</body>
    </html>
  )
}
