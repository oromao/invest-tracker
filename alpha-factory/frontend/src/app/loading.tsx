import { RefreshCcw } from "lucide-react";

export default function Loading() {
  return (
    <div className="flex h-[60vh] w-full flex-col items-center justify-center gap-4">
      <div className="relative">
        <div className="h-16 w-16 rounded-full border-b-2 border-blue-400/80 animate-spin" />
        <RefreshCcw className="absolute inset-0 m-auto h-6 w-6 text-blue-300 animate-pulse" />
      </div>
      <p className="text-xs uppercase tracking-[0.22em] text-white/40 animate-pulse">
        Loading…
      </p>
    </div>
  );
}
