"use client"

import { motion } from "framer-motion"
import { Brain, Wrench, Bot } from "lucide-react"

const features = [
  {
    icon: Brain,
    title: "记忆",
    subtitle: "Memory",
    desc: "Augustus 拥有持久记忆，能记住每一次对话的上下文，跨会话保持一致性。",
  },
  {
    icon: Wrench,
    title: "工具",
    subtitle: "Tools",
    desc: "可自由扩展的工具系统，从代码执行到信息检索，Augustus 都能驾驭。",
  },
  {
    icon: Bot,
    title: "代理",
    subtitle: "Agents",
    desc: "多 Agent 协作架构，每个 Agent 各司其职，共同完成复杂任务。",
  },
]

export function FeatureSection() {
  return (
    <section className="relative z-10 py-32 px-4">
      <div className="max-w-5xl mx-auto">
        <motion.div
          className="text-center mb-20"
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8 }}
        >
          <h2 className="text-3xl md:text-4xl font-bold tracking-[0.15em] text-augustus-text mb-3">
            帝国基石
          </h2>
          <div className="w-16 h-[2px] bg-gradient-to-r from-transparent via-augustus-accent to-transparent mx-auto" />
        </motion.div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {features.map((feature, index) => (
            <motion.div
              key={feature.title}
              className="group relative p-8 border border-augustus-accent/20 rounded-sm bg-gradient-to-b from-augustus-accent/8 to-transparent hover:border-augustus-accent/40 transition-all duration-500"
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: index * 0.15 }}
            >
              <div className="mb-5 w-12 h-12 flex items-center justify-center border border-augustus-accent/30 rounded-sm group-hover:border-augustus-accent/60 group-hover:bg-augustus-accent/15 transition-all duration-500">
                <feature.icon className="w-5 h-5 text-augustus-accent" />
              </div>
              <h3 className="text-xl text-augustus-text font-medium tracking-[0.1em] mb-1">{feature.title}</h3>
              <p className="text-xs text-augustus-accent/70 tracking-[0.2em] uppercase mb-4 font-mono">{feature.subtitle}</p>
              <p className="text-sm text-augustus-text/80 leading-relaxed">{feature.desc}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  )
}
