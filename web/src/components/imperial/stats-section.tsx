"use client"

import { motion } from "framer-motion"

const stats = [
  { value: "∞", label: "对话轮次", desc: "持续增长" },
  { value: "∞", label: "工具集成", desc: "无限扩展" },
  { value: "∞", label: "记忆容量", desc: "永不遗忘" },
]

export function StatsSection() {
  return (
    <section className="relative z-10 py-24 px-4">
      <div className="max-w-4xl mx-auto">
        <motion.div
          className="text-center mb-16"
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8 }}
        >
          <h2 className="text-3xl md:text-4xl font-bold tracking-[0.15em] text-augustus-text mb-3">
            帝国疆域
          </h2>
          <div className="w-16 h-[2px] bg-gradient-to-r from-transparent via-augustus-accent to-transparent mx-auto" />
        </motion.div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-12">
          {stats.map((stat, index) => (
            <motion.div
              key={stat.label}
              className="text-center"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: index * 0.15 }}
            >
              <div className="text-5xl md:text-6xl font-bold text-augustus-accent mb-3 tracking-wider">
                {stat.value}
              </div>
              <div className="text-base text-augustus-text tracking-[0.15em] uppercase mb-2 font-medium">
                {stat.label}
              </div>
              <div className="text-sm text-augustus-text-muted tracking-wide">
                {stat.desc}
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  )
}
