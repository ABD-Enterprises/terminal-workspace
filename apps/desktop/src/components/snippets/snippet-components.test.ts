import React from "react";
import { describe, expect, it } from "vitest";
import { noop, renderWithText } from "../../test/render-helpers";
import { sampleHosts } from "../../types/host";
import { sampleSnippets } from "../../types/snippet";
import { SnippetEditor } from "./SnippetEditor";
import { SnippetList } from "./SnippetList";

describe("snippet components", () => {
  it("renders saved snippet rows and editor targets", () => {
    const snippet = sampleSnippets[0]!;
    const hostsById = Object.fromEntries(sampleHosts.map((host) => [host.id, host]));
    const list = renderWithText(
      React.createElement(SnippetList, {
        hostsById,
        onDelete: noop,
        onDuplicate: noop,
        onEdit: noop,
        onSelect: noop,
        selectedSnippetId: snippet.id,
        snippets: [snippet],
      }),
      snippet.title,
    );
    expect(list).toContain("Duplicate");
    expect(list).toContain("Snippet command preview");

    const editor = renderWithText(
      React.createElement(SnippetEditor, {
        hosts: sampleHosts,
        onClose: noop,
        onSave: noop,
        open: true,
        snippet,
      }),
      "Edit snippet",
    );
    expect(editor).toContain("Default targets");
    expect(editor).toContain(sampleHosts[0]!.label);
  });
});
