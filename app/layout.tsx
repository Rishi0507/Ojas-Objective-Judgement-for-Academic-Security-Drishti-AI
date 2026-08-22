import type { Metadata } from 'next'
import { Bebas_Neue, Inter, Roboto_Mono } from 'next/font/google'
import './globals.css'

const condensed = Bebas_Neue({ subsets: ['latin'], weight: ['400'], variable: '--font-condensed' })
const inter = Inter({ subsets: ['latin'], weight: ['400', '500'], variable: '--font-inter' })
const mono = Roboto_Mono({ subsets: ['latin'], weight: ['400'], variable: '--font-mono' })

export const metadata: Metadata = {
  title: 'DrishtiAI — Exam Hall Video Review',
  description:
    'Offline analysis of exam hall CCTV. Surfaces motion segments and reviewable findings with the frame and bounding box each one came from, for an invigilator to confirm or dismiss.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${condensed.variable} ${inter.variable} ${mono.variable}`}>
      <body className="bg-background text-foreground font-sans antialiased">{children}</body>
    </html>
  )
}
