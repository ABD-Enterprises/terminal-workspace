// Cold-start welcome panel for /hosts. Renders only when the inventory
// is empty (allHosts.length === 0) — replaces the generic "filter shows
// nothing" empty state with three immediate CTAs that get a new user
// inside the product in one click:
//   1. Add host — opens the editor with an empty form.
//   2. Import ~/.ssh/config — opens the file picker (same handler as
//      the toolbar button).
//   3. Open local terminal — ensures the local-shell host record exists
//      and launches a session.
//   4. Try with sample data — flips demoModeEnabled in app-store so the
//      seeded sample inventory appears (browser mode default; Tauri mode
//      opt-in).
//
// Bundle: T01 / T02 / T03 / T04 from the feature-parity 20.

import { useNavigate } from "react-router-dom";
import { launchHostSession } from "../../lib/launch-host-session";
import { useAppStore } from "../../store/app-store";
import { useHostsStore } from "../../store/hosts-store";

interface WelcomePanelProps {
  onAddHost: () => void;
  onImportSshConfig: () => void;
}

export function WelcomePanel({ onAddHost, onImportSshConfig }: WelcomePanelProps) {
  const navigate = useNavigate();
  const ensureLocalShellHost = useHostsStore((state) => state.ensureLocalShellHost);
  const loadSampleData = useHostsStore((state) => state.loadSampleData);
  const setDemoModeEnabled = useAppStore((state) => state.setDemoModeEnabled);

  const handleLocalTerminal = async () => {
    const localShell = ensureLocalShellHost();
    const result = await launchHostSession(localShell);
    if (!result.ok || !result.tabId) {
      if (result.errorMessage) {
        console.warn(`[welcome] ${result.errorMessage}`);
      }
      return;
    }
    navigate(`/sessions?tabId=${result.tabId}`);
  };

  const handleTrySampleData = () => {
    // Two-step: flip the runtime to demo mode (so API calls hit the
    // local mock transport) and populate the hosts store with the
    // seeded sample fixture. demoModeEnabled alone only controls the
    // mock transport — it does NOT re-hydrate stores that already
    // persisted an empty payload, so we need the explicit load.
    setDemoModeEnabled(true);
    loadSampleData();
  };

  return (
    <div
      role="region"
      aria-label="Welcome to TermSnip"
      className="flex h-full min-h-0 flex-col items-center justify-center gap-6 rounded-[24px] border border-dashed border-emerald-400/30 bg-slate-950/50 px-8 py-10 text-center"
    >
      <div className="max-w-xl space-y-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.26em] text-emerald-300">
          Welcome to TermSnip
        </p>
        <h2 className="text-2xl font-semibold text-slate-50">
          Your inventory is empty
        </h2>
        <p className="text-sm leading-6 text-slate-400">
          Get going in one click — pull in your existing SSH config, add a host by hand, open a local terminal,
          or try the app with sample data first.
        </p>
      </div>

      <div className="grid w-full max-w-3xl grid-cols-1 gap-3 md:grid-cols-2">
        <button
          type="button"
          onClick={onImportSshConfig}
          className="group flex flex-col items-start gap-2 rounded-2xl border border-emerald-400/40 bg-emerald-400/10 px-4 py-4 text-left transition hover:border-emerald-400/70 hover:bg-emerald-400/15"
        >
          <span className="text-[10px] font-semibold uppercase tracking-[0.22em] text-emerald-300">
            Recommended
          </span>
          <span className="text-sm font-semibold text-slate-50">
            Import ~/.ssh/config
          </span>
          <span className="text-xs leading-5 text-slate-400">
            Parses your existing OpenSSH config (Hosts, jump-host chains, port + identity inheritance) and brings them in.
          </span>
        </button>

        <button
          type="button"
          onClick={onAddHost}
          className="flex flex-col items-start gap-2 rounded-2xl border border-slate-700 bg-slate-900/70 px-4 py-4 text-left transition hover:border-slate-500 hover:bg-slate-900"
        >
          <span className="text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-500">
            One-by-one
          </span>
          <span className="text-sm font-semibold text-slate-50">Add a host manually</span>
          <span className="text-xs leading-5 text-slate-400">
            Open the editor and fill in label, hostname, protocol, and identity. Saves directly to your local vault.
          </span>
        </button>

        <button
          type="button"
          onClick={handleLocalTerminal}
          className="flex flex-col items-start gap-2 rounded-2xl border border-slate-700 bg-slate-900/70 px-4 py-4 text-left transition hover:border-slate-500 hover:bg-slate-900"
        >
          <span className="text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-500">
            Quick start
          </span>
          <span className="text-sm font-semibold text-slate-50">Open a local terminal</span>
          <span className="text-xs leading-5 text-slate-400">
            Spawns your macOS login shell in a tab so you can use TermSnip even before adding any remote hosts.
          </span>
        </button>

        <button
          type="button"
          onClick={handleTrySampleData}
          className="flex flex-col items-start gap-2 rounded-2xl border border-slate-700 bg-slate-900/70 px-4 py-4 text-left transition hover:border-slate-500 hover:bg-slate-900"
        >
          <span className="text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-500">
            Try first
          </span>
          <span className="text-sm font-semibold text-slate-50">Load sample data</span>
          <span className="text-xs leading-5 text-slate-400">
            Seeds a few mock hosts, snippets, and identities so you can explore. Toggle off any time from Settings.
          </span>
        </button>
      </div>
    </div>
  );
}
