import { describe, expect, it } from "vitest";

import { createLatestRequestGuard } from "./latest-request";

// #182: FileBrowser.loadDirectory had no sequencing, so navigating A then B and
// having A resolve last overwrote B — entries from one directory under another's
// breadcrumb, and rename/delete acting on the wrong one.
//
// These force the ordering with deferred promises rather than timers, so there
// is no timing race in the test itself: A only resolves once the test says so,
// after B has already completed.

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("#182: latest-request-wins", () => {
  it("discards a result that lost the race, and keeps the winner's", async () => {
    const guard = createLatestRequestGuard();
    const committed: string[] = [];
    const slowA = deferred<string>();
    const fastB = deferred<string>();

    const load = async (token: number, source: Promise<string>) => {
      const value = await source;
      if (!guard.isCurrent(token)) {
        return;
      }
      committed.push(value);
    };

    const a = load(guard.begin(), slowA.promise);
    const b = load(guard.begin(), fastB.promise);

    fastB.resolve("B");
    await b;
    // A now resolves LAST — the exact ordering that used to overwrite B.
    slowA.resolve("A");
    await a;

    expect(committed).toEqual(["B"]);
  });

  it("discards a stale REJECTION too, so an old error cannot replace a good load", async () => {
    const guard = createLatestRequestGuard();
    const errors: string[] = [];
    const failingA = deferred<string>();

    const load = async (token: number, source: Promise<string>) => {
      try {
        await source;
      } catch (error) {
        if (!guard.isCurrent(token)) {
          return;
        }
        errors.push(String(error));
      }
    };

    const a = load(guard.begin(), failingA.promise);
    guard.begin(); // a newer navigation supersedes it
    failingA.reject(new Error("stale failure"));
    await a;

    expect(errors).toEqual([]);
  });

  it("cancel supersedes an in-flight request so its result commits nothing", async () => {
    const guard = createLatestRequestGuard();
    const committed: string[] = [];
    const inFlight = deferred<string>();

    const token = guard.begin();
    const load = (async () => {
      const value = await inFlight.promise;
      if (!guard.isCurrent(token)) {
        return;
      }
      committed.push(value);
    })();

    guard.cancel();
    // The underlying request is NOT cancellable, so it still resolves. What the
    // guard guarantees is that its result is not applied.
    inFlight.resolve("late");
    await load;

    expect(committed).toEqual([]);
    expect(guard.isPending()).toBe(false);
  });

  it("tracks whether a load is outstanding", () => {
    const guard = createLatestRequestGuard();

    expect(guard.isPending()).toBe(false);
    const token = guard.begin();
    expect(guard.isPending()).toBe(true);
    expect(guard.isCurrent(token)).toBe(true);

    guard.cancel();
    expect(guard.isPending()).toBe(false);
    expect(guard.isCurrent(token)).toBe(false);
  });

  it("only ever treats the newest claim as current", () => {
    const guard = createLatestRequestGuard();

    const first = guard.begin();
    const second = guard.begin();
    const third = guard.begin();

    expect(guard.isCurrent(first)).toBe(false);
    expect(guard.isCurrent(second)).toBe(false);
    expect(guard.isCurrent(third)).toBe(true);
  });
});
