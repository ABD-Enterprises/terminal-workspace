import React from "react";
import { describe, expect, it } from "vitest";
import { noop, renderWithText } from "../../test/render-helpers";
import { sampleHosts } from "../../types/host";
import { HostCard } from "./HostCard";
import { HostFilterBar } from "./HostFilterBar";
import { HostList } from "./HostList";
import { ImportSshCallout } from "./ImportSshCallout";

describe("host components", () => {
  it("renders the card and list actions for a host", () => {
    const host = sampleHosts[0]!;
    const card = renderWithText(
      React.createElement(HostCard, {
        host,
        onConnect: noop,
        onDelete: noop,
        onEdit: noop,
        onSelect: noop,
        onToggleFavorite: noop,
        selected: true,
      }),
      host.label,
    );
    expect(card).toContain("Connect");

    const list = renderWithText(
      React.createElement(HostList, {
        hosts: [host],
        hostsById: Object.fromEntries(sampleHosts.map((entry) => [entry.id, entry])),
        onConnect: noop,
        onCreateHost: noop,
        onDelete: noop,
        onEdit: noop,
        onSelect: noop,
        onToggleFavorite: noop,
        selectedHostId: host.id,
      }),
      "Actions",
    );
    expect(list).toContain(host.hostname);
    expect(list).toContain("Remove favorite");
  });

  it("renders filter controls and SSH import callout", () => {
    const filters = renderWithText(
      React.createElement(HostFilterBar, {
        activeGroup: "all",
        activeTag: "all",
        favoritesOnly: false,
        groups: ["Acme / Production"],
        onFavoritesToggle: noop,
        onGroupChange: noop,
        onQueryChange: noop,
        onTagChange: noop,
        query: "prod",
        tags: ["prod"],
      }),
      "Favorites only",
    );
    expect(filters).toContain("Acme / Production");
    expect(filters).toContain("prod");

    const callout = renderWithText(
      React.createElement(ImportSshCallout, { onImport: noop }),
      "Bulk-import",
    );
    expect(callout).toContain("~/.ssh/config");
  });
});
