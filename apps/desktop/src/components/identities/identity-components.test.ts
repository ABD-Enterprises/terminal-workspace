import React from "react";
import { describe, expect, it } from "vitest";
import { noop, renderWithText } from "../../test/render-helpers";
import { sampleIdentities } from "../../types/identity";
import { IdentityEditor } from "./IdentityEditor";
import { IdentityList } from "./IdentityList";

describe("identity components", () => {
  it("renders identity usage rows and edit form defaults", () => {
    const identity = sampleIdentities[0]!;
    const usageByIdentityId = new Map([[identity.id, ["prod-gateway"]]]);
    const list = renderWithText(
      React.createElement(IdentityList, {
        editingIdentityId: identity.id,
        identities: [identity],
        onDelete: noop,
        onEdit: noop,
        usageByIdentityId,
      }),
      identity.label,
    );
    expect(list).toContain("1 host");
    expect(list).toContain("Private key");

    const editor = renderWithText(
      React.createElement(IdentityEditor, {
        identity,
        onCancel: noop,
        onSubmit: noop,
        open: true,
      }),
      "Edit identity",
    );
    expect(editor).toContain(identity.privateKeyPath);
    expect(editor).toContain("Key requires a passphrase");
  });
});
