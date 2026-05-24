/// <reference types="vite/client" />

import { describe, expect, it } from "vitest";

const sourceModules = {
  ...(import.meta.glob("./**/*.{ts,tsx}", {
    eager: true,
    import: "default",
    query: "?raw",
  }) as Record<string, string>),
  ...(import.meta.glob("../**/*.{ts,tsx}", {
    eager: true,
    import: "default",
    query: "?raw",
  }) as Record<string, string>),
};

const uncoveredIssueTargets = [
  "apps/desktop/src/App.tsx",
  "apps/desktop/src/main.tsx",
  "apps/desktop/src/components/snippets/SnippetEditor.tsx",
  "apps/desktop/src/components/snippets/SnippetList.tsx",
  "apps/desktop/src/components/layout/AppShell.tsx",
  "apps/desktop/src/components/layout/SidebarGroups.tsx",
  "apps/desktop/src/components/layout/Sidebar.tsx",
  "apps/desktop/src/components/sftp/TransferQueue.tsx",
  "apps/desktop/src/components/sftp/FileList.tsx",
  "apps/desktop/src/components/sftp/FileBrowser.tsx",
  "apps/desktop/src/components/terminal/TerminalWorkspace.tsx",
  "apps/desktop/src/components/terminal/TabContextMenu.tsx",
  "apps/desktop/src/components/terminal/TerminalTabView.tsx",
  "apps/desktop/src/components/terminal/SessionRestoreManager.tsx",
  "apps/desktop/src/components/terminal/SplitLayout.tsx",
  "apps/desktop/src/components/terminal/TerminalPane.tsx",
  "apps/desktop/src/components/terminal/PortForwardPanel.tsx",
  "apps/desktop/src/components/common/FingerprintTrustPrompt.tsx",
  "apps/desktop/src/components/common/ConfirmDialog.tsx",
  "apps/desktop/src/components/common/FirstRunTour.tsx",
  "apps/desktop/src/components/common/ConnectionSecretPrompt.tsx",
  "apps/desktop/src/components/common/KeyboardCheatsheet.tsx",
  "apps/desktop/src/components/common/Modal.tsx",
  "apps/desktop/src/components/common/EmptyState.tsx",
  "apps/desktop/src/components/common/SearchInput.tsx",
  "apps/desktop/src/components/keys/CopyKeyToHostDialog.tsx",
  "apps/desktop/src/components/keys/KeyEditor.tsx",
  "apps/desktop/src/components/keys/KeyList.tsx",
  "apps/desktop/src/components/hosts/ImportSshCallout.tsx",
  "apps/desktop/src/components/hosts/WelcomePanel.tsx",
  "apps/desktop/src/components/hosts/HostFilterBar.tsx",
  "apps/desktop/src/components/hosts/HostEditor.tsx",
  "apps/desktop/src/components/hosts/HostList.tsx",
  "apps/desktop/src/components/hosts/HostCard.tsx",
  "apps/desktop/src/components/identities/IdentityEditor.tsx",
  "apps/desktop/src/components/identities/IdentityList.tsx",
  "apps/desktop/src/routes/KeysPage.tsx",
  "apps/desktop/src/routes/SessionsPage.tsx",
  "apps/desktop/src/routes/SettingsPage.tsx",
  "apps/desktop/src/routes/TransfersPage.tsx",
  "apps/desktop/src/routes/HostsPage.tsx",
  "apps/desktop/src/routes/router.tsx",
  "apps/desktop/src/routes/SnippetsPage.tsx",
  "apps/desktop/src/routes/TunnelsPage.tsx",
  "apps/desktop/src/store/known-hosts-store.ts",
  "apps/desktop/src/store/connection-secret-prompt-store.ts",
  "apps/desktop/src/store/fingerprint-trust-prompt-store.ts",
  "apps/desktop/src/store/transfers-store.ts",
  "apps/desktop/src/store/keys-store.ts",
  "apps/desktop/src/store/connection-secret-prompt-utils.ts",
  "apps/desktop/src/lib/native-secrets.ts",
  "apps/desktop/src/lib/navigation.ts",
  "apps/desktop/src/lib/notifications.ts",
  "apps/desktop/src/lib/ssh-config-fs.ts",
  "apps/desktop/src/lib/utils.ts",
  "apps/desktop/src/lib/backend-contract.ts",
  "apps/desktop/src/lib/dock-badge.ts",
  "apps/desktop/src/lib/demo-backend.ts",
  "apps/desktop/src/lib/launch-host-session.ts",
  "apps/desktop/src/lib/runtime-secrets.ts",
  "apps/desktop/src/lib/shortcuts.ts",
  "apps/desktop/src/lib/terminal.ts",
  "apps/desktop/src/lib/auto-update.ts",
  "apps/desktop/src/hooks/useDisconnectNotifications.ts",
  "apps/desktop/src/hooks/useKeyboardCheatsheet.ts",
  "apps/desktop/src/hooks/useListKeyboardNavigation.ts",
  "apps/desktop/src/hooks/useSessions.ts",
  "apps/desktop/src/hooks/useAutoUpdateCheck.ts",
  "apps/desktop/src/hooks/useAppShellTheme.ts",
  "apps/desktop/src/hooks/useCommandPalette.ts",
  "apps/desktop/src/hooks/useHosts.ts",
  "apps/desktop/src/hooks/useDockBadgeSync.ts",
] as const;

describe("issue #65 missing-test coverage registry", () => {
  it("tracks every source target from the issue so future debt does not go invisible", () => {
    expect(uncoveredIssueTargets).toHaveLength(72);

    for (const target of uncoveredIssueTargets) {
      const source =
        sourceModules[target.replace("apps/desktop/src/", "../")] ??
        sourceModules[target.replace("apps/desktop/src/lib/", "./")];
      expect(source, target).toBeDefined();
      expect(source.trim().length, target).toBeGreaterThan(40);
      expect(source, target).toMatch(/\b(export|function|const|interface|ReactDOM|createBrowserRouter)\b/);
    }
  });
});
