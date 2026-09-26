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
      aria-label="Welcome to Terminal Workspace"
      className="flex h-full min-h-0 flex-col items-center justify-center gap-5 rounded-panel border border-slate-800/80 bg-slate-950/40 px-8 py-10 text-center"
    >
      {/*
        #113: calm empty state — one primary action plus secondary links,
        not a four-card CTA grid. Quick-connect lives at the top of the
        Hosts view; here we guide the user to build their inventory.
      */}
      <div className="max-w-md space-y-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.26em] text-slate-500">
          Welcome to Terminal Workspace
        </p>
        <h2 className="text-2xl font-semibold text-slate-50">Your inventory is empty</h2>
        <p className="text-sm leading-6 text-slate-400">
          Add your first host to get started — or pull in your existing SSH config.
        </p>
      </div>

      <button
        type="button"
        onClick={onAddHost}
        className="rounded-control bg-emerald-400 px-5 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-emerald-300"
      >
        Add a host manually
      </button>

      <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-sm">
        <button
          type="button"
          onClick={onImportSshConfig}
          className="rounded text-slate-300 underline-offset-4 transition hover:text-white hover:underline"
        >
          Import ~/.ssh/config
        </button>
        <span aria-hidden="true" className="text-slate-700">
          ·
        </span>
        <button
          type="button"
          onClick={handleLocalTerminal}
          className="rounded text-slate-300 underline-offset-4 transition hover:text-white hover:underline"
        >
          Open a local terminal
        </button>
        <span aria-hidden="true" className="text-slate-700">
          ·
        </span>
        <button
          type="button"
          onClick={handleTrySampleData}
          className="rounded text-slate-300 underline-offset-4 transition hover:text-white hover:underline"
        >
          Load sample data
        </button>
      </div>
    </div>
  );
}
