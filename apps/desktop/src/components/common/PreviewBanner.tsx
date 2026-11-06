import { useEffect, useState } from "react";
import { getSessionBackendStatus, isTauriRuntime } from "../../lib/backend-runtime";

export function PreviewBanner() {
  const [unreachable, setUnreachable] = useState(false);

  useEffect(() => {
    if (isTauriRuntime()) {
      return;
    }

    let mounted = true;
    void getSessionBackendStatus().catch(() => {
      if (mounted) {
        setUnreachable(true);
      }
    });

    return () => {
      mounted = false;
    };
  }, []);

  if (isTauriRuntime()) {
    return null;
  }

  if (unreachable) {
    return (
      <div
        role="alert"
        className="border-b border-rose-400/40 bg-rose-500/10 px-4 py-2 text-sm font-semibold text-rose-100"
      >
        Backend server unreachable — verify that the preview backend is running.
      </div>
    );
  }

  return (
    <div className="border-b border-amber-300/40 bg-amber-300/10 px-4 py-2 text-sm font-semibold text-amber-100">
      Preview only - Tauri native ship runs without this backend.
    </div>
  );
}
