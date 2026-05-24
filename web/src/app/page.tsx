import Link from "next/link"
import { ParticleBackground } from "@/components/imperial/particle-background"
import { HeroSection } from "@/components/imperial/hero-section"
import { FeatureSection } from "@/components/imperial/feature-section"
import { StatsSection } from "@/components/imperial/stats-section"

const pages = [
  { href: "/chat", label: "对话" },
  { href: "/vision", label: "构想" },
  { href: "/dashboard", label: "概览" },
  { href: "/test", label: "测试" },
  { href: "/tasks", label: "任务" },
  { href: "/settings", label: "设置" },
]

export default function HomePage() {
  return (
    <>
      <ParticleBackground />
      <HeroSection />
      <FeatureSection />
      <StatsSection />

      {/* Page index — 低调入口 */}
      <section className="relative z-10 py-16 text-center">
        <div className="inline-flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs tracking-[0.15em] text-augustus-text-dim">
          {pages.map((p) => (
            <Link
              key={p.href}
              href={p.href}
              className="hover:text-augustus-accent transition-colors"
            >
              {p.label}
            </Link>
          ))}
        </div>
      </section>

      <footer className="relative z-10 pb-10 text-center">
        <div className="h-[1px] bg-gradient-to-r from-transparent via-augustus-accent/30 to-transparent max-w-xl mx-auto mb-6" />
        <p className="text-xs text-augustus-text-muted/50 tracking-[0.2em]">
          AUGUSTUS · YOUR AI EMPIRE
        </p>
      </footer>
    </>
  )
}
