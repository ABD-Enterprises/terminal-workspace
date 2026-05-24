import React from "react";
import { describe, expect, it } from "vitest";
import { noop, renderWithText } from "../../test/render-helpers";
import { sampleHosts } from "../../types/host";
import { sampleKeys } from "../../types/key";
import { CopyKeyToHostDialog } from "./CopyKeyToHostDialog";
import { KeyList } from "./KeyList";

describe("key components", () => {
  it("renders key rows with assignments and copy-to-host dialog", () => {
    const key = sampleKeys[0]!;
    const hostsById = Object.fromEntries(sampleHosts.map((host) => [host.id, host]));
    const keyList = renderWithText(
      React.createElement(KeyList, {
        hosts: hostsById,
        keys: [key],
        onCopyToHost: noop,
        onDelete: noop,
        onSelect: noop,
        selectedKeyId: key.id,
      }),
      key.label,
    );
    expect(keyList).toContain("Copy to host");
    expect(keyList).toContain(sampleHosts[0]!.label);

    const dialog = renderWithText(
      React.createElement(CopyKeyToHostDialog, {
        busy: false,
        hosts: sampleHosts,
        keyRecord: key,
        onCancel: noop,
        onConfirm: noop,
        open: true,
      }),
      "Target host",
    );
    expect(dialog).toContain(key.publicKeyPath);
    expect(dialog).toContain(sampleHosts[0]!.hostname);
  });
});
