import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchJson, fetchResponse } from "./http";

describe("http helpers", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("adds JSON headers and returns parsed JSON", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchJson<{ ok: boolean }>("/api/test", { method: "POST" })).resolves.toEqual({
      ok: true,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/test",
      expect.objectContaining({
        headers: expect.objectContaining({ "Content-Type": "application/json" }),
        method: "POST",
      }),
    );
  });

  it("uses backend error body when a response fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("bad request", { status: 400 })));

    await expect(fetchJson("/api/test")).rejects.toThrow("bad request");
    await expect(fetchResponse("/api/test")).rejects.toThrow("bad request");
  });
});
