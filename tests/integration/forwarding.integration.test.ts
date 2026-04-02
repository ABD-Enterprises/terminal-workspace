import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createLocalForward,
  deleteLocalForward,
  listLocalForwards,
} from "../../apps/desktop/src/lib/api";
import { resetDemoBackend } from "../../apps/desktop/src/lib/demo-backend";
import { useAppStore } from "../../apps/desktop/src/store/app-store";

const baseAppState = useAppStore.getState();

beforeEach(() => {
  resetDemoBackend();
  useAppStore.setState({
    ...useAppStore.getState(),
    demoModeEnabled: true,
  });
});

afterEach(() => {
  resetDemoBackend();
  useAppStore.setState(baseAppState);
});

describe("demo port forwarding workflows", () => {
  it("creates, lists, and deletes forwards for a session", async () => {
    const createdForward = await createLocalForward({
      direction: "local",
      localHost: "127.0.0.1",
      localPort: 15432,
      remoteHost: "127.0.0.1",
      remotePort: 5432,
      sessionId: "demo-session",
    });

    const listedForwards = await listLocalForwards("demo-session");
    expect(listedForwards.forwards).toEqual([createdForward]);

    await deleteLocalForward(createdForward.id);
    await expect(listLocalForwards("demo-session")).resolves.toEqual({ forwards: [] });
  });
});
