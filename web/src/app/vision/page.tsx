import type { Metadata } from "next"
import { NavigationBar } from "@/components/navigation-bar"
import { CoreArchitectureMap } from "@/components/vision/core-architecture-map"

export const metadata: Metadata = {
  title: "构想 | Augustus AI",
  description: "Augustus 的核心架构和对话信息流",
}

export default function VisionPage() {
  return (
    <main className="min-h-screen bg-augustus-bg text-augustus-text">
      <NavigationBar />
      <div className="fixed inset-0 pointer-events-none bg-[radial-gradient(circle_at_50%_0%,var(--augustus-accent-muted),transparent_38%),linear-gradient(to_bottom,var(--augustus-bg),var(--augustus-bg-card),var(--augustus-bg))]" />

      <div className="relative z-10 mx-auto flex min-h-screen max-w-7xl flex-col px-3 pb-8 pt-20 sm:px-5 md:pt-24 lg:px-8">
        <header className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.22em] text-augustus-accent">Vision</p>
            <h1 className="mt-2 text-2xl font-light tracking-[0.04em] text-augustus-text sm:text-3xl">
              Augustus 核心架构
            </h1>
          </div>
          <p className="max-w-xl text-sm leading-6 text-augustus-text-muted">
            一张图讲清楚：对话信息如何进入 Runtime，如何被任务、Agent、工具、记忆和验证系统处理，最后回到用户并沉淀为长期上下文。
          </p>
        </header>

        <CoreArchitectureMap />
      </div>
    </main>
  )
}
