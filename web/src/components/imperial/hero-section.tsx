"use client"

import { motion } from "framer-motion"
import { ImperialLogo } from "./imperial-logo"
import { ScrollIndicator } from "./scroll-indicator"

export function HeroSection() {
  return (
    <section className="relative z-10 flex flex-col items-center justify-center min-h-screen px-4">
      <div className="mb-8">
        <ImperialLogo size={100} />
      </div>

      <motion.h1
        className="text-5xl md:text-7xl lg:text-8xl font-bold tracking-[0.25em] text-augustus-text mb-4 drop-shadow-[0_0_20px_var(--augustus-accent)/0.15]"
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 1.2, delay: 0.3, ease: "easeOut" }}
      >
        AUGUSTUS
      </motion.h1>

      <motion.div
        className="w-24 h-[2px] bg-gradient-to-r from-transparent via-augustus-accent to-transparent mb-6"
        initial={{ scaleX: 0, opacity: 0 }}
        animate={{ scaleX: 1, opacity: 1 }}
        transition={{ duration: 1, delay: 0.8, ease: "easeOut" }}
      />

      <motion.p
        className="text-xl md:text-2xl text-augustus-accent tracking-[0.2em] font-light"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 1, delay: 1, ease: "easeOut" }}
      >
        Your AI Empire
      </motion.p>

      <motion.div
        className="mt-14"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8, delay: 1.5, ease: "easeOut" }}
      >
        <a
          href="/chat"
          className="group relative inline-flex items-center gap-3 px-10 py-4 border-2 border-augustus-accent/60 rounded-sm
                     text-augustus-accent text-base tracking-[0.2em] uppercase font-medium
                     transition-all duration-500
                     hover:border-augustus-accent hover:bg-augustus-accent/15 hover:shadow-[0_0_40px_var(--augustus-accent)/0.2]
                     active:scale-[0.98]"
        >
          <span className="relative z-10">踏入帝国</span>
          <span className="relative z-10 group-hover:translate-x-1.5 transition-transform duration-300">→</span>
          <span className="absolute inset-0 rounded-sm bg-transparent group-hover:bg-augustus-accent/10 transition-all duration-500" />
        </a>
      </motion.div>

      <ScrollIndicator />
    </section>
  )
}
