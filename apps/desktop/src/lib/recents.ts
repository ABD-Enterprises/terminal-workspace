// Shared selectors for "most recent" lists. Both Sidebar.tsx (T06
// Recent panel) and AppShell.tsx (palette's Recent command surface)
// computed the same lastConnectedAt-desc + filter-non-empty shape
// independently. Audit consolidation: one helper here, two call
// sites use it.

import type { HostRecord } from "../types/host";
import type { SnippetRecord } from "../types/snippet";

/**
 * Hosts the user actually connected to, sorted most-recent-first.
 * Hosts without a lastConnectedAt are excluded (they've never been
 * connected to so they're not "recent").
 *
 * @param limit  Maximum entries to return. Pass Infinity for "all".
 */
export function selectMostRecentlyConnectedHosts(
  hosts: readonly HostRecord[],
  limit: number
): HostRecord[] {
  return hosts
    .filter((host) => Boolean(host.lastConnectedAt))
    .sort((left, right) =>
      (right.lastConnectedAt ?? "").localeCompare(left.lastConnectedAt ?? "")
    )
    .slice(0, limit);
}

/**
 * Snippets the user actually ran, sorted most-recent-first. Snippets
 * without a lastRunAt are excluded.
 *
 * @param limit  Maximum entries to return. Pass Infinity for "all".
 */
export function selectMostRecentlyRunSnippets(
  snippets: readonly SnippetRecord[],
  limit: number
): SnippetRecord[] {
  return snippets
    .filter((snippet) => Boolean(snippet.lastRunAt))
    .sort((left, right) =>
      (right.lastRunAt ?? "").localeCompare(left.lastRunAt ?? "")
    )
    .slice(0, limit);
}
