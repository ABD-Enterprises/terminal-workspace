// Sidebar widget that groups hosts by `host.group` and lets the user
// expand, drag-and-drop between groups, rename a group inline, and detach
// a group's hosts. P2-DM2 collapse: this replaces the older
// `SidebarEnvironments` component which kept a parallel `EnvironmentRecord`
// store linked to hosts by string match — see
// docs/parity-and-hardening-review.md §2.2 / §6.7 and
// docs/parity-and-hardening-plan.md P2-DM2.
//
// Why we dropped the EnvironmentRecord entity:
//   - The "link" between Environment and Host was `host.group === env.name`,
//     a magic string match with no foreign key. Renaming the env did not
//     re-link the hosts; the user had to walk every host record manually.
//   - The Environment.type field ("aws" / "k8s" / "region" / "custom") was
//     decoration only — never consulted by the runtime.
//   - Two parallel sources of truth violated the IA gap called out in the
//     review.
// The new model is single-axis: `host.group` is the canonical organizing
// string. Groups are derived from the host collection on demand. Renaming
// a group is now a real bulk action via `useHostsStore.renameGroup`.

import { useMemo, useState } from "react";
import { cn } from "../../lib/utils";
import { useHostsStore } from "../../store/hosts-store";
import { useSessionsStore } from "../../store/sessions-store";
import { SidebarSection } from "./SidebarSection";

interface DerivedGroup {
  name: string;
  hostIds: string[];
}

const UNGROUPED_KEY = "__ungrouped__";

function deriveGroups(hosts: ReturnType<typeof useHostsStore.getState>["hosts"]): DerivedGroup[] {
  const buckets = new Map<string, string[]>();
  for (const host of hosts) {
    const key = host.group?.trim() || UNGROUPED_KEY;
    const existing = buckets.get(key);
    if (existing) {
      existing.push(host.id);
    } else {
      buckets.set(key, [host.id]);
    }
  }
  // Sort: real groups alphabetically, "Ungrouped" pinned to the bottom.
  const named = Array.from(buckets.entries())
    .filter(([key]) => key !== UNGROUPED_KEY)
    .map(([name, hostIds]) => ({ name, hostIds }))
    .sort((left, right) => left.name.localeCompare(right.name));
  const ungrouped = buckets.get(UNGROUPED_KEY);
  if (ungrouped && ungrouped.length > 0) {
    named.push({ name: UNGROUPED_KEY, hostIds: ungrouped });
  }
  return named;
}

interface SidebarGroupsProps {
  searchQuery: string;
}

export function SidebarGroups({ searchQuery }: SidebarGroupsProps) {
  const hosts = useHostsStore((state) => state.hosts);
  const updateHost = useHostsStore((state) => state.updateHost);
  const renameGroup = useHostsStore((state) => state.renameGroup);
  const removeGroup = useHostsStore((state) => state.removeGroup);
  const sessionTabs = useSessionsStore((state) => state.tabs);

  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [renamingGroup, setRenamingGroup] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [draggedOverGroup, setDraggedOverGroup] = useState<string | null>(null);

  const activeHostIds = useMemo(
    () => new Set(sessionTabs.map((tab) => tab.hostId).filter(Boolean)),
    [sessionTabs]
  );
  const hostsById = useMemo(
    () => new Map(hosts.map((host) => [host.id, host])),
    [hosts]
  );
  const groups = useMemo(() => deriveGroups(hosts), [hosts]);
  const queryLower = searchQuery.trim().toLowerCase();
  const filteredGroups = useMemo(() => {
    if (!queryLower) {
      return groups;
    }
    return groups.filter((group) => {
      const name = group.name === UNGROUPED_KEY ? "ungrouped" : group.name.toLowerCase();
      if (name.includes(queryLower)) {
        return true;
      }
      return group.hostIds.some((hostId) => {
        const host = hostsById.get(hostId);
        return host?.label.toLowerCase().includes(queryLower);
      });
    });
  }, [groups, hostsById, queryLower]);

  const toggleGroup = (key: string) => {
    setExpanded((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const startRename = (groupName: string) => {
    if (groupName === UNGROUPED_KEY) {
      return;
    }
    setRenamingGroup(groupName);
    setRenameDraft(groupName);
  };

  const commitRename = () => {
    if (!renamingGroup) {
      return;
    }
    const next = renameDraft.trim();
    if (!next || next === renamingGroup) {
      setRenamingGroup(null);
      return;
    }
    renameGroup(renamingGroup, next);
    setRenamingGroup(null);
  };

  const onDragStart = (event: React.DragEvent, hostId: string) => {
    event.dataTransfer.setData("text/plain", hostId);
  };

  const onDragOver = (event: React.DragEvent, key: string) => {
    event.preventDefault();
    setDraggedOverGroup(key);
  };

  const onDragLeave = () => setDraggedOverGroup(null);

  const onDrop = (event: React.DragEvent, key: string) => {
    event.preventDefault();
    setDraggedOverGroup(null);
    const hostId = event.dataTransfer.getData("text/plain");
    if (!hostId) {
      return;
    }
    const host = hostsById.get(hostId);
    if (!host) {
      return;
    }
    const targetGroup = key === UNGROUPED_KEY ? "" : key;
    if (host.group === targetGroup) {
      return;
    }
    updateHost(host.id, {
      label: host.label,
      protocol: host.protocol,
      hostname: host.hostname,
      username: host.username,
      port: String(host.port),
      authMethod: host.authMethod,
      password: "",
      privateKeyPath: host.privateKeyPath,
      passphrase: "",
      group: targetGroup,
      tags: host.tags.join(", "),
      note: host.note,
      favorite: host.favorite,
      keyLabel: host.keyLabel,
      hostKeyPolicy: host.hostKeyPolicy,
      agentForwarding: host.agentForwarding,
      environment: Object.entries(host.environment)
        .map(([k, v]) => `${k}=${v}`)
        .join("\n"),
      jumpHostId: host.jumpHostId ?? "",
      sftpRoot: host.sftpRoot,
      identityId: host.identityId ?? "",
    });
  };

  return (
    <SidebarSection title="Groups" count={groups.length}>
      {filteredGroups.length === 0 ? (
        <p className="px-2 py-1 text-footnote text-slate-500">
          {hosts.length === 0
            ? "No hosts yet — add one from the Hosts page."
            : "No groups match the current search."}
        </p>
      ) : null}
      {filteredGroups.map((group) => {
          const isUngrouped = group.name === UNGROUPED_KEY;
          const displayName = isUngrouped ? "Ungrouped" : group.name;
          const groupKey = group.name;
          const isExpanded = expanded[groupKey];
          const isDragOver = draggedOverGroup === groupKey;
          const groupHosts = group.hostIds
            .map((id) => hostsById.get(id))
            .filter((host): host is NonNullable<typeof host> => Boolean(host));
          const connectedCount = groupHosts.filter((host) => activeHostIds.has(host.id))
            .length;
          const isRenaming = renamingGroup === group.name;

          return (
            <div
              key={groupKey}
              className={cn(
                "mb-1 rounded-surface",
                isDragOver && "bg-emerald-400/10 border border-emerald-400/50"
              )}
              onDragOver={(event) => onDragOver(event, groupKey)}
              onDragLeave={onDragLeave}
              onDrop={(event) => onDrop(event, groupKey)}
            >
              <div className="group flex w-full items-center justify-between rounded-surface px-2 py-1.5 hover:bg-slate-800/50 transition">
                <button
                  type="button"
                  onClick={() => toggleGroup(groupKey)}
                  className="flex min-w-0 flex-1 items-center gap-2 text-left"
                >
                  <span className="text-caption text-slate-500 w-3 text-center">
                    {isExpanded ? "▼" : "▶"}
                  </span>
                  {isRenaming ? (
                    <input
                      autoFocus
                      value={renameDraft}
                      onClick={(event) => event.stopPropagation()}
                      onChange={(event) => setRenameDraft(event.target.value)}
                      onKeyDown={(event) => {
                        event.stopPropagation();
                        if (event.key === "Enter") {
                          event.preventDefault();
                          commitRename();
                        } else if (event.key === "Escape") {
                          event.preventDefault();
                          setRenamingGroup(null);
                        }
                      }}
                      onBlur={commitRename}
                      className="flex-1 rounded bg-slate-950/80 px-1.5 py-0.5 text-body text-slate-100 outline-none ring-1 ring-emerald-400/40 focus:ring-emerald-400"
                    />
                  ) : (
                    <span
                      className={cn(
                        "truncate text-body font-medium",
                        isUngrouped ? "text-slate-500 italic" : "text-slate-200"
                      )}
                    >
                      {displayName}
                    </span>
                  )}
                </button>
                <div className="flex shrink-0 items-center gap-2">
                  {!isUngrouped ? (
                    <div className="hidden gap-1 group-hover:flex">
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          startRename(group.name);
                        }}
                        title="Rename group (updates every host)"
                        aria-label={`Rename group ${displayName}`}
                        className="text-caption text-slate-400 transition hover:text-emerald-400"
                      >
                        ✎
                      </button>
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          if (
                            window.confirm(
                              `Detach all hosts from "${group.name}"? Hosts are not deleted; they fall into Ungrouped.`
                            )
                          ) {
                            removeGroup(group.name);
                          }
                        }}
                        title="Detach all hosts from this group"
                        aria-label={`Remove group ${displayName}`}
                        className="text-caption text-slate-400 transition hover:text-rose-400"
                      >
                        ×
                      </button>
                    </div>
                  ) : null}
                  <span className="text-caption text-slate-500">
                    {groupHosts.length} host{groupHosts.length === 1 ? "" : "s"}
                  </span>
                  {connectedCount > 0 ? (
                    <span className="text-caption text-emerald-400">
                      {connectedCount} conn
                    </span>
                  ) : null}
                </div>
              </div>

              {isExpanded && groupHosts.length > 0 ? (
                <div className="ml-5 mt-1 space-y-0.5 border-l border-slate-800/50 pl-2 pb-1">
                  {groupHosts.map((host) => {
                    const isConnected = activeHostIds.has(host.id);
                    return (
                      <div
                        key={host.id}
                        draggable
                        onDragStart={(event) => onDragStart(event, host.id)}
                        className="flex items-center justify-between rounded-control px-2 py-1 hover:bg-slate-800/40 cursor-grab active:cursor-grabbing"
                      >
                        <span className="truncate text-footnote text-slate-300">{host.label}</span>
                        {isConnected ? (
                          <div className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              ) : null}
            </div>
          );
        })}
    </SidebarSection>
  );
}

// Re-exported for tests so the derivation can be asserted without rendering.
export const __testing = {
  deriveGroups,
  UNGROUPED_KEY,
};
