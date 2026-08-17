/**
 * #182: a latest-request-wins guard for async UI loads.
 *
 * The bug it closes: `FileBrowser.loadDirectory` had no sequencing. Navigate to
 * A then quickly to B, and if A resolved last it overwrote B — the list showed
 * A's entries while the breadcrumb said B, and rename/delete then acted on the
 * wrong directory. Silent, and destructive.
 *
 * Why a sequence number and not an AbortController: the request cannot actually
 * be cancelled. `listRemoteDirectory` takes no signal, and under Tauri it goes
 * through `invokeTauriCommand`, which has no abort mechanism at all. Threading a
 * controller through here would abort nothing while looking like it did. What is
 * genuinely achievable is refusing to COMMIT a superseded result, which is what
 * actually prevents the wrong directory being shown or acted on.
 *
 * So `cancel()` means "stop waiting for this and discard whatever it returns",
 * not "stop the server doing it". The distinction is deliberate and is why the
 * UI wording says the load was cancelled rather than the operation.
 */
export interface LatestRequestGuard {
  /** Claim the next sequence number, superseding anything already in flight. */
  begin: () => number;
  /** True only while `token` is still the newest claim. */
  isCurrent: (token: number) => boolean;
  /** Supersede whatever is in flight without starting anything new. */
  cancel: () => void;
  /** True when a claim is outstanding and has not been superseded. */
  isPending: () => boolean;
}

export function createLatestRequestGuard(): LatestRequestGuard {
  let sequence = 0;
  let pending = false;

  return {
    begin() {
      sequence += 1;
      pending = true;
      return sequence;
    },
    isCurrent(token: number) {
      return token === sequence;
    },
    cancel() {
      // Incrementing is what supersedes: a late resolution compares against the
      // new value, fails isCurrent, and commits nothing.
      sequence += 1;
      pending = false;
    },
    isPending() {
      return pending;
    },
  };
}
