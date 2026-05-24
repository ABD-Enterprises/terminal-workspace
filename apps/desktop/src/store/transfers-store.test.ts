import { describe, expect, it } from "vitest";
import { useTransfersStore } from "./transfers-store";

describe("transfers store", () => {
  it("tracks active host paths and transfer lifecycle", () => {
    useTransfersStore.setState({ activeHostId: undefined, queue: [], remotePathByHost: {} });

    useTransfersStore.getState().setActiveHost("prod-gateway");
    useTransfersStore.getState().rememberRemotePath("prod-gateway", "/srv");
    const id = useTransfersStore.getState().queueTransfer({
      bytes: 1024,
      direction: "download",
      hostId: "prod-gateway",
      hostLabel: "Production Gateway",
      name: "app.log",
      remotePath: "/srv/app.log",
    });

    expect(useTransfersStore.getState().activeHostId).toBe("prod-gateway");
    expect(useTransfersStore.getState().remotePathByHost["prod-gateway"]).toBe("/srv");
    expect(useTransfersStore.getState().queue[0]).toMatchObject({ id, status: "queued" });

    useTransfersStore.getState().markTransferRunning(id);
    expect(useTransfersStore.getState().queue[0]?.status).toBe("running");

    useTransfersStore.getState().failTransfer(id, "network dropped");
    expect(useTransfersStore.getState().queue[0]).toMatchObject({
      errorMessage: "network dropped",
      status: "failed",
    });

    useTransfersStore.getState().completeTransfer(id, { bytes: 2048 });
    expect(useTransfersStore.getState().queue[0]).toMatchObject({
      bytes: 2048,
      errorMessage: undefined,
      status: "completed",
    });

    useTransfersStore.getState().clearCompleted();
    expect(useTransfersStore.getState().queue).toHaveLength(0);
  });
});
