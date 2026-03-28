"use client";

import { motion } from "framer-motion";
import { 
  ArrowUpRight, 
  TrendingUp, 
  TrendingDown, 
  ShieldAlert, 
  Zap, 
  ChevronRight,
  MoreVertical
} from "lucide-react";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface PositionProps {
  id: string;
  asset: string;
  side: "LONG" | "SHORT";
  size: number;
  entry_price: number;
  mark_price: number;
  pnl: number;
  pnl_percent: number;
  leverage: number;
}

export default function PositionCard({ position }: { position: PositionProps }) {
  const isProfit = position.pnl > 0;

  return (
    <motion.div
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      className="p-6 bg-black/40 border border-white/5 rounded-2xl backdrop-blur-xl group hover:border-cyan-500/30 transition-all duration-500"
    >
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <div className={cn(
            "w-12 h-12 rounded-xl flex items-center justify-center border",
            position.side === "LONG" ? "bg-green-500/10 border-green-500/20 text-green-400" : "bg-red-500/10 border-red-500/20 text-red-400"
          )}>
            {position.side === "LONG" ? <TrendingUp className="w-6 h-6" /> : <TrendingDown className="w-6 h-6" />}
          </div>
          <div>
            <h3 className="text-xl font-bold text-white font-mono">{position.asset}</h3>
            <div className="flex items-center gap-2">
               <span className={cn(
                 "text-[10px] font-bold font-mono tracking-widest px-1.5 py-0.5 rounded",
                 position.side === "LONG" ? "bg-green-500/20 text-green-400" : "bg-red-500/20 text-red-400"
               )}>{position.side} {position.leverage}X</span>
               <span className="text-[10px] text-white/30 font-mono tracking-widest uppercase">ID: {position.id.slice(0, 8)}</span>
            </div>
          </div>
        </div>
        <button className="p-2 text-white/30 hover:text-white transition-colors">
          <MoreVertical className="w-4 h-4" />
        </button>
      </div>

      <div className="grid grid-cols-2 gap-4 mb-6">
         <div className="p-4 bg-white/5 rounded-xl border border-white/5">
            <p className="text-[9px] text-white/30 uppercase tracking-widest mb-1">Position Size</p>
            <p className="text-sm font-bold font-mono text-white">{position.size.toLocaleString()} {position.asset.split("/")[0]}</p>
         </div>
         <div className="p-4 bg-white/5 rounded-xl border border-white/5">
            <p className="text-[9px] text-white/30 uppercase tracking-widest mb-1">Entry Price</p>
            <p className="text-sm font-bold font-mono text-white">${position.entry_price.toLocaleString()}</p>
         </div>
      </div>

      {/* PnL Section */}
      <div className={cn(
        "p-5 rounded-2xl border transition-all duration-500 flex justify-between items-center mb-6",
        isProfit ? "bg-green-500/5 border-green-500/20" : "bg-red-500/5 border-red-500/20"
      )}>
         <div>
            <p className="text-[10px] text-white/40 uppercase tracking-widest font-mono mb-1">Unrealized PnL</p>
            <p className={cn("text-2xl font-black font-mono", isProfit ? "text-green-400" : "text-red-400")}>
               {isProfit ? "+" : ""}{position.pnl.toLocaleString()} <span className="text-sm font-medium">USDT</span>
            </p>
         </div>
         <div className="flex flex-col items-end">
            <div className={cn(
              "flex items-center gap-1 font-black font-mono text-lg mb-0.5",
              isProfit ? "text-green-400" : "text-red-400"
            )}>
               {isProfit ? <ArrowUpRight className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
               {position.pnl_percent.toFixed(2)}%
            </div>
            <p className="text-[10px] text-white/30 uppercase tracking-[0.2em] font-mono">Current ROE</p>
         </div>
      </div>

      <div className="flex items-center justify-between border-t border-white/5 pt-4 text-[10px] font-mono tracking-widest text-white/30">
         <div className="flex gap-4">
            <div className="flex items-center gap-1.5">
               <ShieldAlert className="w-3 h-3 text-red-500/50" />
               <span>Liq. Price: $12,482</span>
            </div>
            <div className="flex items-center gap-1.5">
               <Zap className="w-3 h-3 text-yellow-500/50" />
               <span>Margin: $4,200</span>
            </div>
         </div>
         <button className="text-cyan-400 hover:text-cyan-300 transition-colors uppercase font-bold flex items-center gap-1">
            Close
            <ChevronRight className="w-3 h-3" />
         </button>
      </div>
    </motion.div>
  );
}
