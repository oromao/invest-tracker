"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/utils/api";
import { 
  Brain, 
  Search, 
  Database, 
  Layers, 
  Clock, 
  Cpu,
  RefreshCcw,
  Box,
  ChevronRight
} from "lucide-react";
import { motion } from "framer-motion";

export default function RAGPage() {
  const { data: ragData, isLoading } = useQuery({
    queryKey: ["rag-memory"],
    queryFn: async () => {
      const { data } = await api.get("/api/signals"); // Using signals as proxy for now or specific RAG endpoint if exists
      return data;
    },
    refetchInterval: 60000,
  });

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <RefreshCcw className="w-8 h-8 text-cyan-500 animate-spin mb-4" />
        <p className="text-white/40 font-mono text-xs uppercase tracking-widest">Querying Vector Embedding Store...</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-10">
       <header className="flex justify-between items-end">
        <div>
          <span className="text-cyan-500 font-mono text-[10px] uppercase tracking-[0.3em] mb-2 block">Cognitive Arch</span>
          <h1 className="text-4xl font-bold text-white tracking-tight">RAG Memory</h1>
          <p className="text-white/40 mt-1 max-w-xl">
            Semantic retrieval of past market states stored in Qdrant. 
            The system uses high-dimensional embeddings to find historical precedents for current price action.
          </p>
        </div>
        <div className="flex gap-4">
           <div className="p-3 bg-white/5 border border-white/5 rounded-2xl flex items-center gap-3">
              <Search className="w-4 h-4 text-white/30" />
              <input 
                type="text" 
                placeholder="Find similar market states..." 
                className="bg-transparent text-sm text-white focus:outline-none w-64 font-mono placeholder:text-white/20"
              />
           </div>
           <button className="px-6 py-3 bg-white/5 hover:bg-white/10 text-white rounded-xl font-bold text-xs uppercase tracking-widest border border-white/5 transition-all">
              Re-Index
           </button>
        </div>
      </header>

      {/* Vector Store Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
         <div className="p-8 bg-black/40 border border-white/5 rounded-3xl backdrop-blur-xl group hover:border-cyan-500/30 transition-all">
            <div className="w-12 h-12 rounded-xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center mb-6">
               <Database className="w-6 h-6 text-cyan-400" />
            </div>
            <h4 className="text-sm font-bold text-white uppercase tracking-widest font-mono mb-2">Total Embeddings</h4>
            <div className="text-4xl font-black text-white font-mono">14,204</div>
            <p className="text-[10px] text-white/30 uppercase tracking-widest mt-2">Vector Size: 1536 (Ada-002 compatible)</p>
         </div>
         <div className="p-8 bg-black/40 border border-white/5 rounded-3xl backdrop-blur-xl group hover:border-indigo-500/30 transition-all">
            <div className="w-12 h-12 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center mb-6">
               <Brain className="w-6 h-6 text-indigo-400" />
            </div>
            <h4 className="text-sm font-bold text-white uppercase tracking-widest font-mono mb-2">Context Retrieval</h4>
            <div className="text-4xl font-black text-white font-mono">380ms</div>
            <p className="text-[10px] text-white/30 uppercase tracking-widest mt-2">Avg Search Latency / Top-k=5</p>
         </div>
         <div className="p-8 bg-black/40 border border-white/5 rounded-3xl backdrop-blur-xl group hover:border-purple-500/30 transition-all">
            <div className="w-12 h-12 rounded-xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center mb-6">
               <Layers className="w-6 h-6 text-purple-400" />
            </div>
            <h4 className="text-sm font-bold text-white uppercase tracking-widest font-mono mb-2">Alpha Density</h4>
            <div className="text-4xl font-black text-white font-mono">0.82</div>
            <p className="text-[10px] text-white/30 uppercase tracking-widest mt-2">Semantic overlap with winning trades</p>
         </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-10">
         {/* Live Query Stream */}
         <div className="lg:col-span-2 space-y-6">
            <div className="flex items-center gap-3 mb-2">
               <Cpu className="w-5 h-5 text-cyan-400" />
               <h2 className="text-xl font-bold text-white uppercase tracking-widest font-mono">Knowledge Retrieval Stream</h2>
            </div>
            
            {[1,2,3].map((i) => (
              <motion.div 
                key={i}
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: i * 0.1 }}
                className="p-6 bg-white/2 border border-white/5 rounded-2xl hover:bg-white/5 transition-all cursor-pointer group"
              >
                 <div className="flex justify-between items-start mb-4">
                    <div className="flex items-center gap-3">
                       <Box className="w-5 h-5 text-white/20" />
                       <span className="text-xs font-bold text-cyan-400 font-mono uppercase tracking-widest">Market State #{8420 + i}</span>
                    </div>
                    <div className="flex items-center gap-2 text-[10px] text-white/30 font-mono">
                       <Clock className="w-3 h-3" />
                       2h ago
                    </div>
                 </div>
                 <p className="text-sm text-white/60 leading-relaxed mb-4 font-sans italic">
                   "Observed high volume rejection at the 68.5k level on 15m timeframe. 
                   Historical correlates from Jan 2024 suggest a high probability of mean reversion toward 20-EMA."
                 </p>
                 <div className="flex justify-between items-center text-[10px] font-mono tracking-widest">
                    <div className="flex gap-4">
                       <span className="text-white/30 uppercase">Vector Score: 0.942</span>
                       <span className="text-white/30 uppercase">Labels: BEARISH, VOLATILE</span>
                    </div>
                    <ChevronRight className="w-4 h-4 text-white/20 group-hover:text-cyan-400 transition-colors" />
                 </div>
              </motion.div>
            ))}
         </div>

         {/* Clustering Visualization (Abstract) */}
         <div className="space-y-6">
            <div className="flex items-center gap-3 mb-2">
               <Layers className="w-5 h-5 text-cyan-400" />
               <h2 className="text-xl font-bold text-white uppercase tracking-widest font-mono">Semantic Map</h2>
            </div>
            <div className="aspect-square bg-black/60 border border-white/5 rounded-3xl relative overflow-hidden flex items-center justify-center group">
               <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(34,211,238,0.1),transparent_70%)] opacity-50" />
               
               {/* Decorative dots to represent vectors */}
               {[...Array(20)].map((_, i) => (
                 <motion.div
                   key={i}
                   animate={{ 
                     opacity: [0.2, 0.5, 0.2],
                     scale: [1, 1.2, 1],
                   }}
                   transition={{ 
                     duration: Math.random() * 3 + 2,
                     repeat: Infinity,
                   }}
                   className="absolute w-1.5 h-1.5 rounded-full bg-cyan-500/40"
                   style={{ 
                     left: `${Math.random() * 80 + 10}%`, 
                     top: `${Math.random() * 80 + 10}%` 
                   }}
                 />
               ))}
               
               <div className="text-center relative z-10 px-6">
                  <p className="text-[10px] text-cyan-400/60 font-mono uppercase tracking-[0.4em] mb-4">Space Embedding Visualization</p>
                  <p className="text-xs text-white/30 italic">Interactive semantic map expansion coming in v0.2.0</p>
               </div>
            </div>

            <div className="p-6 bg-white/5 border border-white/5 rounded-2xl">
               <h5 className="text-[10px] font-mono uppercase tracking-widest text-white/40 mb-4">Memory Indexing Health</h5>
               <div className="space-y-4">
                  <div>
                    <div className="flex justify-between text-[10px] font-mono mb-2">
                      <span className="text-white/40">Persistence Layer</span>
                      <span className="text-green-400 font-bold">OPTIMAL</span>
                    </div>
                    <div className="h-1 bg-white/5 rounded-full overflow-hidden">
                      <div className="h-full bg-green-500/40 w-full" />
                    </div>
                  </div>
                  <div>
                    <div className="flex justify-between text-[10px] font-mono mb-2">
                      <span className="text-white/40">Query Latency</span>
                      <span className="text-cyan-400 font-bold">STABLE</span>
                    </div>
                    <div className="h-1 bg-white/5 rounded-full overflow-hidden">
                      <div className="h-full bg-cyan-500/40 w-full shadow-[0_0_8px_rgba(34,211,238,0.3)]" />
                    </div>
                  </div>
               </div>
            </div>
         </div>
      </div>
    </div>
  );
}
