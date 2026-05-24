import React from "react";
import { describe, expect, it } from "vitest";
import { action, noop, renderMarkup, renderWithText } from "../../test/render-helpers";
import { ConfirmDialog } from "./ConfirmDialog";
import { EmptyState } from "./EmptyState";
import { Modal } from "./Modal";
import { SearchInput } from "./SearchInput";

describe("common components", () => {
  it("renders modal chrome only when open", () => {
    expect(
      renderMarkup(
        React.createElement(Modal, {
          children: "Hidden body",
          onClose: noop,
          open: false,
          title: "Hidden",
        }),
      ),
    ).toBe("");

    const markup = renderWithText(
      React.createElement(Modal, {
        children: "Dialog body",
        description: "Operator action",
        footer: action("Done"),
        onClose: noop,
        open: true,
        title: "Visible dialog",
      }),
      "Visible dialog",
    );

    expect(markup).toContain("Operator action");
    expect(markup).toContain("Done");
  });

  it("renders confirm dialog actions and empty-state action slots", () => {
    const confirm = renderWithText(
      React.createElement(ConfirmDialog, {
        confirmLabel: "Delete host",
        description: "This cannot be undone.",
        onCancel: noop,
        onConfirm: noop,
        open: true,
        title: "Delete Production Gateway",
      }),
      "Delete Production Gateway",
    );

    expect(confirm).toContain("Delete host");

    const empty = renderWithText(
      React.createElement(EmptyState, {
        action: action("Create first host"),
        description: "No rows match.",
        title: "No hosts",
      }),
      "No hosts",
    );

    expect(empty).toContain("Create first host");
  });

  it("renders search input placeholder and clear affordance", () => {
    const empty = renderWithText(
      React.createElement(SearchInput, {
        onChange: noop,
        placeholder: "Search hosts",
        value: "",
      }),
      "Search hosts",
    );
    expect(empty).not.toContain("Clear");

    const populated = renderWithText(
      React.createElement(SearchInput, {
        onChange: noop,
        placeholder: "Search hosts",
        value: "prod",
      }),
      "Clear",
    );
    expect(populated).toContain("prod");
  });
});
