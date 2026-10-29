import { useAppStore } from "../../store/app-store";

// Demo-mode indicator.
//
// Demo mode swaps every connection for a mock transport, so the command
// output, the SFTP listing, and the host-key scan a user sees are all
// fabricated. The native app used to show no indicator at all in this state
// (`PreviewBanner` returns null under Tauri), and the only warning was one
// line buried in terminal scrollback that read like a feature rather than a
// warning. A user who clicked "Load sample data" could then run an entire
// "successful" workflow against fake output without knowing it.
//
// This banner shows in every runtime whenever demo mode is on.

export function DemoModeBanner() {
  const demoModeEnabled = useAppStore((state) => state.demoModeEnabled);

  if (!demoModeEnabled) {
    return null;
  }

  return (
    <div
      role="status"
      aria-label="Demo mode"
      className="border-b border-amber-300/40 bg-amber-300/10 px-4 py-2 text-sm font-semibold text-amber-100"
    >
      Demo mode — connections are simulated and the output you see is fabricated, not real.
    </div>
  );
}
