"use client"

import { useState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { Menu, X, MessageSquare, LayoutDashboard, Settings, FlaskConical, ListTodo, Compass } from "lucide-react"
import Link from "next/link"
import { usePathname } from "next/navigation"

const navItems = [
  { href: "/", label: "首页" },
  { href: "/chat", label: "对话", icon: MessageSquare },
  { href: "/tasks", label: "任务", icon: ListTodo },
  { href: "/vision", label: "构想", icon: Compass },
  { href: "/dashboard", label: "概览", icon: LayoutDashboard },
  { href: "/test", label: "测试", icon: FlaskConical },
  { href: "/settings", label: "设置", icon: Settings },
]

export function NavigationBar() {
  const [open, setOpen] = useState(false)
  const pathname = usePathname()

  return (
    <>
      {/* 移动端标题栏 */}
      <nav className="fixed left-0 right-0 top-0 z-50 h-16 border-b border-augustus-border/70 bg-augustus-bg/86 backdrop-blur-md md:hidden">
        <div className="flex h-full items-center px-4 pr-28">
          <Link
            href="/"
            className="truncate text-sm tracking-[0.18em] text-augustus-text/75 transition-colors hover:text-augustus-accent"
          >
            AUGUSTUS
          </Link>
        </div>
      </nav>

      {/* 桌面导航 */}
      <nav className="fixed top-0 left-0 right-0 z-50 hidden h-16 border-b border-augustus-border/70 bg-augustus-bg/82 backdrop-blur-md md:block">
        <div className="flex h-full w-full items-center px-6 pr-20">
          <div className="flex w-full items-center justify-between">
            <Link
              href="/"
              className="flex h-10 items-center text-sm tracking-[0.2em] text-augustus-text/70 transition-colors hover:text-augustus-accent"
            >
              AUGUSTUS
            </Link>
            <div className="flex h-10 items-center gap-6">
              {navItems.map((item) => {
                const isActive = pathname === item.href
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`flex h-10 items-center text-xs tracking-[0.15em] uppercase transition-all duration-300 ${
                      isActive
                        ? "text-augustus-accent"
                        : "text-augustus-text/50 hover:text-augustus-text/80"
                    }`}
                  >
                    {item.label}
                  </Link>
                )
              })}
            </div>
          </div>
        </div>
        <div className="pointer-events-none absolute bottom-0 left-6 right-20 h-px bg-gradient-to-r from-transparent via-augustus-accent/20 to-transparent" />
      </nav>

      {/* 移动端汉堡按钮 */}
      <button
        onClick={() => setOpen(!open)}
        aria-label={open ? "关闭导航菜单" : "打开导航菜单"}
        className="fixed right-16 top-3 z-[60] flex h-10 w-10 items-center justify-center rounded-md border border-augustus-border bg-augustus-bg-card/85 text-augustus-text-muted shadow-[var(--augustus-shadow)] backdrop-blur transition-colors hover:border-augustus-border-hover hover:bg-augustus-accent-muted hover:text-augustus-accent md:hidden"
      >
        {open ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
      </button>

      {/* 移动端菜单 */}
      <AnimatePresence>
        {open && (
          <motion.div
            className="fixed inset-0 z-40 bg-augustus-bg/95 backdrop-blur-lg md:hidden flex flex-col items-center justify-center gap-8"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            {navItems.map((item, i) => (
              <motion.div
                key={item.href}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.1 }}
              >
                <Link
                  href={item.href}
                  onClick={() => setOpen(false)}
                  className="text-2xl tracking-[0.15em] text-augustus-text/70 hover:text-augustus-accent transition-colors"
                >
                  {item.label}
                </Link>
              </motion.div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
