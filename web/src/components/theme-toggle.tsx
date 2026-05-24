"use client"

import { Moon, Sun } from "lucide-react"
import { useEffect, useState } from "react"

type AugustusTheme = "light" | "dark"

const STORAGE_KEY = "augustus-theme"
const THEME_CLASSES = ["augustus-light", "dark"]

function applyTheme(theme: AugustusTheme) {
  const root = document.documentElement
  root.classList.remove(...THEME_CLASSES)
  root.classList.add(theme === "dark" ? "dark" : "augustus-light")
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<AugustusTheme>("light")

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY)
    const nextTheme: AugustusTheme = stored === "dark" ? "dark" : "light"
    setTheme(nextTheme)
    applyTheme(nextTheme)
  }, [])

  const toggleTheme = () => {
    const nextTheme = theme === "dark" ? "light" : "dark"
    setTheme(nextTheme)
    localStorage.setItem(STORAGE_KEY, nextTheme)
    applyTheme(nextTheme)
  }

  const isDark = theme === "dark"

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={isDark ? "切换到浅色主题" : "切换到深色主题"}
      title={isDark ? "切换到浅色主题" : "切换到深色主题"}
      className="fixed right-4 top-3 z-[60] flex h-10 w-10 items-center justify-center rounded-md border border-augustus-border bg-augustus-bg-card/85 text-augustus-text-muted shadow-[var(--augustus-shadow)] backdrop-blur transition-colors hover:border-augustus-border-hover hover:bg-augustus-accent-muted hover:text-augustus-accent focus:outline-none focus:ring-2 focus:ring-augustus-accent-ring"
    >
      {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </button>
  )
}
