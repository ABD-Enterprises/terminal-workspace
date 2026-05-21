import { isTauriRuntime } from "../../lib/backend-runtime";

export function PreviewBanner() {
  if (isTauriRuntime()) {
    return null;
  }

  return (
    <div className="border-b border-amber-300/40 bg-amber-300/10 px-4 py-2 text-sm font-semibold text-amber-100">
      Preview only - Tauri native ship runs without this backend.
    </div>
  );
}
