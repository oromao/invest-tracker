"use client";

import { motion } from "framer-motion";
import { 
  ArrowUpRight, 
  ArrowDownRight, 
  Clock, 
  Shield, 
  Info,
  ChevronRight,
  TrendingUp,
  TrendingDown,
  Monitor,
  Brain
} from "lucide-react";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { formatDistanceToNow } from "date-fns";

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface SignalProps {
  asset: string;
  direction: "LONG" | "SHORT" | "NO_TRADE";
  confidence: number;
  entry_price?: number;
  tp1?: number;
  sl?: number;
  explanation?: string;
  timestamp: string;
  regime?: string;
  strategy_name?: string;
}

export default function SignalCard({ signal }: { signal: SignalProps }) {
  const isLong = signal.direction === "LONG";
  const isShort = signal.direction === "SHORT";
  const isNoTrade = signal.direction === "NO_TRADE";

  if (isNoTrade) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="glow-border group rounded-2xl overflow-hidden mb-6"
    >
      <div className="p-6">
        {/* Header */}
        <div className="flex justify-between items-start mb-6">
          <div className="flex items-center gap-4">
            <div className={cn(
              "w-12 h-12 rounded-xl flex items-center justify-center border",
              isLong ? "bg-green-500/10 border-green-500/20" : "bg-red-500/10 border-red-500/20"
            )}>
              {isLong ? (
                <TrendingUp className="w-6 h-6 text-green-400" />
              ) : (
                <TrendingDown className="w-6 h-6 text-red-400" />
              )}
            </div>
            <div>
              <h3 className="text-xl font-bold font-mono tracking-tight text-white">{signal.asset}</h3>
              <div className="flex items-center gap-2 text-[10px] uppercase font-mono tracking-widest text-white/40">
                <Clock className="w-3 h-3" />
                {formatDistanceToNow(new Date(signal.timestamp), { addSuffix: true })}
              </div>
            </div>
          </div>
          
          <div className={cn(
            "px-3 py-1 rounded-full text-[10px] font-bold font-mono tracking-widest border",
            isLong ? "bg-green-500/10 border-green-500/40 text-green-400" : "bg-red-500/10 border-red-500/40 text-red-400"
          )}>
            {signal.direction}
          </div>
        </div>

        {/* Confidence Meter */}
        <div className="mb-6">
          <div className="flex justify-between text-[11px] font-mono mb-2">
            <span className="text-white/40 uppercase tracking-widest">Signal Confidence</span>
            <span className={cn(
               "font-bold",
                isLong ? "text-green-400" : "text-red-400"
            )}>{(signal.confidence * 100).toFixed(1)}%</span>
          </div>
          <div className="h-1.5 w-full bg-white/5 rounded-full overflow-hidden">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${signal.confidence * 100}%` }}
              className={cn(
                "h-full shadow-[0_0_10px_rgba(34,211,238,0.5)]",
                isLong ? "bg-green-500" : "bg-red-500"
              )}
            />
          </div>
        </div>

        {/* Price Targets */}
        <div className="grid grid-cols-3 gap-4 mb-6">
          <div className="p-3 bg-white/5 rounded-xl border border-white/5">
            <p className="text-[9px] text-white/30 uppercase tracking-widest mb-1">Entry Price</p>
            <p className="text-sm font-bold font-mono text-white">${signal.entry_price?.toLocaleString()}</p>
          </div>
          <div className="p-3 bg-green-500/5 rounded-xl border border-green-500/10">
            <p className="text-[9px] text-green-400/50 uppercase tracking-widest mb-1">Target (TP)</p>
            <p className="text-sm font-bold font-mono text-green-400">${signal.tp1?.toLocaleString()}</p>
          </div>
          <div className="p-3 bg-red-500/5 rounded-xl border border-red-500/10">
            <p className="text-[9px] text-red-400/50 uppercase tracking-widest mb-1">Stop Loss (SL)</p>
            <p className="text-sm font-bold font-mono text-red-400">${signal.sl?.toLocaleString()}</p>
          </div>
        </div>

        {/* Narrative Section (LLM Rationale) */}
        {signal.explanation && (
          <div className="p-4 bg-indigo-500/5 rounded-xl border border-indigo-500/10 group-hover:border-indigo-500/30 transition-all duration-500">
            <div className="flex items-center gap-2 mb-2">
              <Brain className="w-3.5 h-3.5 text-indigo-400" />
              <span className="text-[10px] font-mono uppercase tracking-[0.2em] text-indigo-400">LLM Rationale</span>
            </div>
            <p className="text-xs text-white/60 leading-relaxed font-sans italic selection:bg-indigo-500/30">
              "{signal.explanation}"
            </p>
          </div>
        )}

        {/* Footer Metadata */}
        <div className="mt-6 flex items-center justify-between border-t border-white/5 pt-4">
          <div className="flex gap-4">
            <div className="flex items-center gap-1.5">
              <Monitor className="w-3 h-3 text-white/30" />
              <span className="text-[10px] font-mono text-white/30 uppercase">{signal.regime}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <Shield className="w-3 h-3 text-white/30" />
              <span className="text-[10px] font-mono text-white/30 uppercase">{signal.strategy_name}</span>
            </div>
          </div>
          <button className="flex items-center gap-1 text-[10px] font-bold text-cyan-400 hover:text-cyan-300 transition-colors uppercase tracking-widest">
            Details
            <ChevronRight className="w-3 h-3" />
          </button>
        </div>
      </div>
    </motion.div>
  );
}
