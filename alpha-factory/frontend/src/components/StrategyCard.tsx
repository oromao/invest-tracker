"use client";

import { motion } from "framer-motion";
import { 
  BarChart, 
  TrendingUp, 
  Shield, 
  Zap, 
  Star, 
  ChevronRight,
  TrendingDown
} from "lucide-react";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface StrategyProps {
  id: string;
  name: string;
  sharpe_ratio: number;
  total_return: number;
  win_rate: number;
  is_promoted: boolean;
  regime: number;
}

export default function StrategyCard({ strategy }: { strategy: StrategyProps }) {
  const isWinner = strategy.sharpe_ratio > 1.5;
  const isPositive = strategy.total_return > 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="p-6 bg-black/40 border border-white/5 rounded-2xl backdrop-blur-xl group hover:border-cyan-500/30 transition-all duration-500 relative overflow-hidden"
    >
      {strategy.is_promoted && (
        <div className="absolute top-0 right-0 p-3">
          <Star className="w-4 h-4 text-yellow-500 fill-yellow-500 shadow-[0_0_15px_rgba(234,179,8,0.5)]" />
        </div>
      )}

      <div className="flex items-start justify-between mb-8">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-white/5 border border-white/10 rounded-lg flex items-center justify-center">
            <Shield className="w-5 h-5 text-white/40" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-white mb-0.5">{strategy.name}</h3>
            <p className="text-[10px] text-white/30 uppercase tracking-[0.2em] font-mono">ID: {strategy.id.slice(0, 8)}</p>
          </div>
        </div>
        <div className={cn(
           "px-2 py-1 rounded text-[10px] font-bold font-mono tracking-widest uppercase",
           strategy.is_promoted ? "bg-yellow-500/10 text-yellow-500 border border-yellow-500/20" : "bg-white/5 text-white/40 border border-white/10"
        )}>
          {strategy.is_promoted ? "Promoted" : "Candidate"}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 mb-8 text-center font-mono">
        <div className="p-4 bg-white/5 rounded-xl border border-white/5 border-b-2 border-b-cyan-500/30">
          <p className="text-[9px] text-white/30 uppercase tracking-widest mb-1">Sharpe Ratio</p>
          <p className={cn("text-xl font-bold font-mono", isWinner ? "text-cyan-400" : "text-white/80")}>
            {strategy.sharpe_ratio.toFixed(2)}
          </p>
        </div>
        <div className="p-4 bg-white/5 rounded-xl border border-white/5 border-b-2 border-b-green-500/30">
          <p className="text-[9px] text-white/30 uppercase tracking-widest mb-1">Performance</p>
          <p className={cn("text-xl font-bold font-mono", isPositive ? "text-green-400" : "text-red-400")}>
            {strategy.total_return > 0 ? "+" : ""}{(strategy.total_return * 100).toFixed(1)}%
          </p>
        </div>
      </div>

      <div className="space-y-4 mb-8">
        <div>
          <div className="flex justify-between text-[11px] font-mono mb-2">
            <span className="text-white/40 uppercase tracking-widest">Base Win Rate</span>
            <span className="text-white font-bold">{(strategy.win_rate * 100).toFixed(1)}%</span>
          </div>
          <div className="h-1 w-full bg-white/5 rounded-full overflow-hidden">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${strategy.win_rate * 100}%` }}
              className="h-full bg-cyan-500 shadow-[0_0_10px_rgba(34,211,238,0.5)]"
            />
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between border-t border-white/5 pt-4">
        <div className="flex items-center gap-2">
           <Zap className="w-3.5 h-3.5 text-yellow-500/70" />
           <span className="text-[10px] text-white/30 uppercase font-mono tracking-widest">Regime {strategy.regime} Optimized</span>
        </div>
        <button className="p-2 bg-white/5 hover:bg-white/10 rounded-lg transition-colors">
          <ChevronRight className="w-4 h-4 text-white/40" />
        </button>
      </div>
    </motion.div>
  );
}
