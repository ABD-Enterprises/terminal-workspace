// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CommandPaletteDialog } from "./CommandPaletteDialog";
import type { useCommandPaletteRows } from "./use-command-palette-rows";

describe("CommandPaletteDialog", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders with dialog role, aria-modal, and accessible name (#506)", () => {
    const mockProps = {
      paletteQuery: "",
      setPaletteQuery: vi.fn(),
      paletteRows: [],
      paletteSelectedIndex: 0,
      setPaletteSelectedIndex: vi.fn(),
      inputRef: { current: null },
      activeSessionTab: undefined,
      activeSessionPane: undefined,
      matchingSections: [],
      matchingHosts: [],
      matchingSessionTabs: [],
      matchingSnippets: [],
      matchingActiveCommands: [],
      matchingRecent: [],
      selectedRowKey: "",
      isRowSelected: () => false,
      handleRowEnter: vi.fn(),
      focusHost: vi.fn(),
      launchHostSession: vi.fn(),
      openHostTransfers: vi.fn(),
      manageHostTrust: vi.fn(),
      focusSection: vi.fn(),
      focusSession: vi.fn(),
      runSnippetInActivePane: vi.fn(),
    } as unknown as ReturnType<typeof useCommandPaletteRows>;

    render(
      <MemoryRouter>
        <CommandPaletteDialog {...mockProps} />
      </MemoryRouter>
    );

    const dialog = screen.getByRole("dialog", { name: "Command palette" });
    expect(dialog).toBeDefined();
    expect(dialog.getAttribute("aria-modal")).toBe("true");
  });
});
