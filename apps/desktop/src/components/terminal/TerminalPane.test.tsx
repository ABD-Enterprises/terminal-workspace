// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TerminalPane } from "./TerminalPane";
import { type HostRecord } from "../../types/host";
import { type SessionPane } from "../../types/session";

describe("TerminalPane error notice (#515)", () => {
  afterEach(cleanup);

  const mockHost: HostRecord = {
    id: "host-1",
    label: "Production Server",
    hostname: "prod.internal",
    port: 22,
    username: "root",
    protocol: "ssh",
    authMethod: "password",
    privateKeyPath: "",
    hostKeyPolicy: "allowUnknown",
    agentForwarding: false,
    environment: {},
  };

  const basePane: SessionPane = {
    id: "pane-1",
    hostId: "host-1",
    title: "Terminal 1",
    connectionState: "error",
    connectionError: "SSH session transport failed.",
    transport: "native",
    queuedCommands: [],
    reconnectOnRestore: false,
    persistOutputPreview: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  it("renders dismissible notice in pane header when error occurs, and allows dismissing", () => {
    const { rerender } = render(
      <TerminalPane
        host={mockHost}
        pane={basePane}
        active={true}
        onActivate={vi.fn()}
        onSplit={vi.fn()}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByText("Connection failed: SSH session transport failed.")).toBeDefined();
    const dismissButton = screen.getByRole("button", { name: "Dismiss error notice" });
    expect(dismissButton).toBeDefined();

    // Click dismiss -> notice is hidden
    fireEvent.click(dismissButton);
    expect(screen.queryByText("Connection failed: SSH session transport failed.")).toBeNull();

    // Leaves error state (e.g. connecting)
    rerender(
      <TerminalPane
        host={mockHost}
        pane={{ ...basePane, connectionState: "connecting", connectionError: undefined }}
        active={true}
        onActivate={vi.fn()}
        onSplit={vi.fn()}
        onClose={vi.fn()}
      />
    );

    // Fails again with the same error -> notice reappears!
    rerender(
      <TerminalPane
        host={mockHost}
        pane={basePane}
        active={true}
        onActivate={vi.fn()}
        onSplit={vi.fn()}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByText("Connection failed: SSH session transport failed.")).toBeDefined();
  });
});
