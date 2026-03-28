import { RefreshCcw } from "lucide-react";

export default function Loading() {
  return (
    <div className="w-full h-[60vh] flex flex-col items-center justify-center">
      <div className="relative">
        <div className="w-16 h-16 rounded-full border-b-2 border-cyan-500 animate-spin" />
        <RefreshCcw className="absolute inset-0 m-auto w-6 h-6 text-cyan-400 animate-pulse" />
      </div>
      <p className="text-white/40 font-mono text-xs uppercase tracking-widest mt-8 animate-pulse">Synchronizing Neural Alpha...</p>
    </div>
  );
}
