import type { Metadata } from "next"
import { ThemeToggle } from "@/components/theme-toggle"
import "./globals.css"

export const metadata: Metadata = {
  title: "Augustus AI",
  description: "Augustus AI Agent 交互界面",
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="zh-CN" className="augustus-light">
      <body className="antialiased">
        <ThemeToggle />
        {children}
      </body>
    </html>
  )
}
