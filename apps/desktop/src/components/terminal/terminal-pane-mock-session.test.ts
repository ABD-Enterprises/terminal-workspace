import { describe, expect, it, vi } from "vitest";
import { createTerminalPaneMockSession } from "./terminal-pane-mock-session";

function ref<T>(current: T) {
  return { current };
}

describe("createTerminalPaneMockSession", () => {
  it("records mock command output and writes a fresh prompt", () => {
    const writes: string[] = [];
    const output = vi.fn();
    const activeHistoryEntryIdRef = ref<string | undefined>("history-1");
    const commandBufferRef = ref("upt");
    const session = createTerminalPaneMockSession({
      activeHistoryEntryIdRef,
      appendCommandOutput: output,
      commandBufferRef,
      group: "Prod",
      hostname: "example.internal",
      label: "Example",
      port: 22,
      protocol: "ssh",
      sftpRoot: "/home",
      stableTags: ["prod"],
      terminal: {
        clear: vi.fn(),
        write: (value: string) => writes.push(value),
        writeln: (value: string) => writes.push(value),
      },
      username: "ops",
    });

    session.runMockCommand("uptime");

    expect(output).toHaveBeenCalledWith("history-1", expect.stringContaining("uptime"));
    expect(activeHistoryEntryIdRef.current).toBeUndefined();
    expect(commandBufferRef.current).toBe("");
    // The typed command is echoed without a newline, so the response has
    // to open its own line instead of running onto the prompt.
    expect(writes[0]).toBe("\r\n");
    expect(writes[writes.length - 1]).toContain("ops@example");
  });

  it("adds no blank line when the command has no response", () => {
    const writes: string[] = [];
    const output = vi.fn();
    const activeHistoryEntryIdRef = ref<string | undefined>(undefined);
    const commandBufferRef = ref("");
    const session = createTerminalPaneMockSession({
      activeHistoryEntryIdRef,
      appendCommandOutput: output,
      commandBufferRef,
      group: "Prod",
      hostname: "example.internal",
      label: "Example",
      port: 22,
      protocol: "ssh",
      sftpRoot: "/home",
      stableTags: ["prod"],
      terminal: {
        clear: vi.fn(),
        write: (value: string) => writes.push(value),
        writeln: (value: string) => writes.push(value),
      },
      username: "ops",
    });

    // Blank Enter: `buildMockCommandResponse` returns no lines, so the
    // only write must be the fresh prompt — no stray empty line.
    session.runMockCommand("");

    expect(output).not.toHaveBeenCalled();
    expect(writes).toHaveLength(1);
    expect(writes[0]).toContain("ops@example");
  });
});
