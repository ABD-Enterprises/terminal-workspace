export const terminalPaneStateStyles = {
  connecting: "border-amber-400/50 bg-amber-400/10 text-amber-100",
  connected: "border-emerald-400/50 bg-emerald-400/10 text-emerald-100",
  pendingSecrets: "border-cyan-400/50 bg-cyan-400/10 text-cyan-100",
  disconnected: "border-slate-700 bg-slate-950/80 text-slate-300",
  error: "border-rose-400/50 bg-rose-400/10 text-rose-100",
} as const;
