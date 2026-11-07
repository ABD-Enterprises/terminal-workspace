import { useEffect, useState } from "react";
import {
  BackendProbeError,
  isTauriRuntime,
  probeBackendStatus,
  type BackendProbeFailureKind,
} from "../../lib/backend-runtime";

const ALERT_CLASS =
  "border-b border-rose-400/40 bg-rose-500/10 px-4 py-2 text-sm font-semibold text-rose-100";

const FAILURE_MESSAGES: Record<BackendProbeFailureKind, string> = {
  unreachable: "Backend server unreachable — verify that the preview backend is running.",
  unauthorized:
    "Backend refused this page — check that this page's origin is allowed (TERMSNIP_ALLOWED_ORIGINS).",
  error: "Backend returned an unexpected error — check the preview backend's output.",
};

export function PreviewBanner() {
  const [failure, setFailure] = useState<BackendProbeFailureKind | null>(null);

  useEffect(() => {
    if (isTauriRuntime()) {
      return;
    }

    let mounted = true;
    void probeBackendStatus().catch((error: unknown) => {
      if (mounted) {
        setFailure(error instanceof BackendProbeError ? error.kind : "unreachable");
      }
    });

    return () => {
      mounted = false;
    };
  }, []);

  if (isTauriRuntime()) {
    return null;
  }

  if (failure) {
    return (
      <div role="alert" className={ALERT_CLASS}>
        {FAILURE_MESSAGES[failure]}
      </div>
    );
  }

  return (
    <div className="border-b border-amber-300/40 bg-amber-300/10 px-4 py-2 text-sm font-semibold text-amber-100">
      Preview only - Tauri native ship runs without this backend.
    </div>
  );
}
