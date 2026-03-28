"use client";

import { motion } from "framer-motion";
import { 
  Zap, 
  Wind, 
  Pause, 
  ArrowUp, 
  ArrowDown, 
  Activity 
} from "lucide-react";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface RegimeProps {
  regime: number; // 0: Trending Up, 1: Trending Down, 2: Volatile/Mixed, 3: Calm/Range
  label?: string;
  count?: number;
}

const REGIME_CONFIG: Record<number, any> = {
  0: { 
    label: "BULLISH TREND", 
    icon: ArrowUp, 
    color: "text-green-400", 
    bg: "bg-green-500/10", 
    border: "border-green-500/30",
    description: "Strong upward momentum detected. Low volatility, high conviction."
  },
  1: { 
    label: "BEARISH TREND", 
    icon: ArrowDown, 
    color: "text-red-400", 
    bg: "bg-red-500/10", 
    border: "border-red-500/30",
    description: "Sustained downward pressure. Exit long positions, look for short alpha."
  },
  2: { 
    label: "VOLATILE / MIXED", 
    icon: Activity, 
    color: "text-yellow-400", 
    bg: "bg-yellow-500/10", 
    border: "border-yellow-500/30",
    description: "High noise, unpredictable swings. Use tight risk management."
  },
  3: { 
    label: "CALM / RANGE", 
    icon: Pause, 
    color: "text-cyan-400", 
    bg: "bg-cyan-500/10", 
    border: "border-cyan-500/30",
    description: "Sideways consolidation. Mean reversion strategies preferred."
  }
};

export default function RegimeCard({ regime, current = false }: { regime: number, current?: boolean }) {
  const config = REGIME_CONFIG[regime] || REGIME_CONFIG[2];
  const Icon = config.icon;

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className={cn(
        "p-6 rounded-2xl border transition-all duration-500",
        config.bg, config.border,
        current ? "shadow-[0_0_30px_rgba(34,211,238,0.15)] ring-1 ring-cyan-500/30" : ""
      )}
    >
      <div className="flex items-center gap-4 mb-4">
        <div className={cn("w-12 h-12 rounded-xl flex items-center justify-center bg-black/20 border border-white/5", config.color)}>
          <Icon className="w-6 h-6" />
        </div>
        <div>
          <h3 className={cn("font-bold font-mono tracking-widest text-sm", config.color)}>
            {config.label}
          </h3>
          <p className="text-[10px] text-white/30 uppercase tracking-widest font-mono">
            {current ? "Current State" : "Historical State"}
          </p>
        </div>
        {current && (
           <div className="ml-auto w-2 h-2 rounded-full bg-cyan-400 animate-pulse shadow-[0_0_10px_rgba(34,211,238,1)]" />
        )}
      </div>

      <p className="text-xs text-white/60 leading-relaxed font-sans mb-6">
        {config.description}
      </p>

      <div className="flex justify-between items-center text-[10px] font-mono border-t border-white/5 pt-4">
        <span className="text-white/30 uppercase tracking-widest">K-Means Cluster: {regime}</span>
        <span className="text-white/50">{current ? "UPDATED JUST NOW" : "RECURRING PATTERN"}</span>
      </div>
    </motion.div>
  );
}
