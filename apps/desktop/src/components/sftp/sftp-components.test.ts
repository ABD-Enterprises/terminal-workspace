import React from "react";
import { describe, expect, it } from "vitest";
import { noop, renderWithText } from "../../test/render-helpers";
import type { RemoteFileEntry, TransferItem } from "../../types/transfer";
import { FileList } from "./FileList";
import { TransferQueue } from "./TransferQueue";

describe("sftp components", () => {
  it("renders remote file rows and transfer queue state", () => {
    const entries: RemoteFileEntry[] = [
      {
        kind: "directory",
        modifiedAt: "2026-03-29T10:00:00.000Z",
        name: "logs",
        path: "/srv/logs",
        permissions: "drwxr-xr-x",
        size: 0,
      },
      {
        kind: "file",
        modifiedAt: "2026-03-29T10:01:00.000Z",
        name: "app.log",
        path: "/srv/logs/app.log",
        permissions: "-rw-r--r--",
        size: 1536,
      },
    ];
    const files = renderWithText(
      React.createElement(FileList, {
        currentPath: "/srv",
        entries,
        onNavigateUp: noop,
        onOpen: noop,
        onSelect: noop,
        selectedPath: "/srv/logs/app.log",
      }),
      "app.log",
    );
    expect(files).toContain("Parent");
    expect(files).toContain("1.5 KB");

    const item: TransferItem = {
      bytes: 4096,
      createdAt: "2026-03-29T10:00:00.000Z",
      direction: "download",
      hostId: "prod-gateway",
      hostLabel: "Production Gateway",
      id: "transfer-1",
      name: "app.log",
      remotePath: "/srv/logs/app.log",
      status: "completed",
      updatedAt: "2026-03-29T10:01:00.000Z",
    };
    const queue = renderWithText(
      React.createElement(TransferQueue, {
        items: [item],
        onClearCompleted: noop,
      }),
      "Transfer queue",
    );
    expect(queue).toContain("Clear done");
    expect(queue).toContain("4.0 KB");
  });
});
