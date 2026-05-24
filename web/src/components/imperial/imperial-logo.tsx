"use client"

import { motion } from "framer-motion"

interface ImperialLogoProps {
  size?: number
  animate?: boolean
}

export function ImperialLogo({ size = 80, animate = true }: ImperialLogoProps) {
  const logo = (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="drop-shadow-[0_0_30px_rgba(201,168,76,0.3)]"
    >
      <ellipse cx="50" cy="50" rx="45" ry="45" stroke="url(#gold-gradient)" strokeWidth="1.5" fill="none" opacity="0.6" />
      <ellipse cx="50" cy="50" rx="35" ry="35" stroke="url(#gold-gradient)" strokeWidth="0.5" fill="none" opacity="0.3" />
      <path d="M50 20 L28 78 L36 78 L42 62 L58 62 L64 78 L72 78 L50 20Z" fill="url(#a-gradient)" className="drop-shadow-[0_0_10px_rgba(201,168,76,0.5)]" />
      <rect x="38" y="54" width="24" height="4" rx="2" fill="#C9A84C" opacity="0.8" />
      <circle cx="50" cy="18" r="2.5" fill="#E8C96A" opacity="0.8" />
      <defs>
        <linearGradient id="gold-gradient" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#C9A84C" />
          <stop offset="50%" stopColor="#E8C96A" />
          <stop offset="100%" stopColor="#C9A84C" />
        </linearGradient>
        <linearGradient id="a-gradient" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#C9A84C" />
          <stop offset="50%" stopColor="#E8C96A" />
          <stop offset="100%" stopColor="#B8942E" />
        </linearGradient>
      </defs>
    </svg>
  )

  if (!animate) return logo

  return (
    <motion.div
      initial={{ scale: 0.8, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ duration: 1.5, ease: "easeOut" }}
      className="relative inline-flex items-center justify-center"
    >
      <motion.div
        className="absolute inset-0 rounded-full bg-augustus-accent/10 blur-3xl"
        animate={{ scale: [1, 1.2, 1], opacity: [0.3, 0.6, 0.3] }}
        transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
      />
      {logo}
    </motion.div>
  )
}
