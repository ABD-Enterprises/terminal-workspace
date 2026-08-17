import { describe, expect, it } from "vitest";

import { markHostConnectedInCollection } from "../../store/hosts-store";
import { sampleHosts } from "../../types/host";
import { terminalEnvironmentKey, terminalTagsKey } from "../../lib/terminal";

// #175: TerminalPane's terminal-owning effect used to depend on the `host`,
// `environment` and `tags` OBJECTS. hosts-store rebuilds every host record on any
// mutation (markHostConnectedInCollection -> sortHostCollection ->
// map(normalizeHostRecord)), so those identities changed even for hosts nobody
// touched — and the effect responded by calling terminal.dispose() and
// socket.close() on every open pane. Running a snippet on one host wiped the
// scrollback of all the others.
//
// This drives the REAL store mutation rather than a hand-built stand-in, because
// the churn lives in the store, not in the component. It asserts both directions:
// a mutation that changes nothing the terminal cares about must not move the
// keys, and a genuine change must.

describe("#175: a host-store mutation does not churn the terminal's dependencies", () => {
  it("rebuilds host objects — the precondition that made this a bug", () => {
    const hosts = sampleHosts.map((host) => ({ ...host }));
    const target = hosts[0];

    const after = markHostConnectedInCollection(hosts, target.id);
    const other = after.find((host) => host.id !== target.id);
    const otherBefore = hosts.find((host) => host.id === other?.id);

    expect(other).toBeDefined();
    // If this ever stops being true the store got structural sharing and this
    // whole class of churn is gone — a good thing, but this test's premise
    // would need revisiting rather than silently passing.
    expect(other).not.toBe(otherBefore);
  });

  it("leaves the environment and tag keys untouched for an unrelated host", () => {
    const hosts = sampleHosts.map((host) => ({ ...host }));
    const target = hosts[0];
    const other = hosts[1];
    const environmentBefore = terminalEnvironmentKey(other.environment);
    const tagsBefore = terminalTagsKey(other.tags);

    const after = markHostConnectedInCollection(hosts, target.id);
    const rebuilt = after.find((host) => host.id === other.id);

    expect(rebuilt).toBeDefined();
    expect(terminalEnvironmentKey(rebuilt!.environment)).toBe(environmentBefore);
    expect(terminalTagsKey(rebuilt!.tags)).toBe(tagsBefore);
  });

  it("leaves them untouched for the connected host itself", () => {
    // markConnected changes lastConnectedAt on THIS record, which is what made a
    // whole-object comparison insufficient: the active terminal tore itself down
    // on its own connect.
    const hosts = sampleHosts.map((host) => ({ ...host }));
    const target = hosts[0];
    const environmentBefore = terminalEnvironmentKey(target.environment);
    const tagsBefore = terminalTagsKey(target.tags);

    const after = markHostConnectedInCollection(hosts, target.id);
    const rebuilt = after.find((host) => host.id === target.id);

    expect(rebuilt).toBeDefined();
    expect(rebuilt!.lastConnectedAt).not.toBe(target.lastConnectedAt);
    expect(terminalEnvironmentKey(rebuilt!.environment)).toBe(environmentBefore);
    expect(terminalTagsKey(rebuilt!.tags)).toBe(tagsBefore);
  });

  it("still reports a real environment change", () => {
    const before = terminalEnvironmentKey({ TERM: "xterm-256color" });

    expect(terminalEnvironmentKey({ TERM: "vt100" })).not.toBe(before);
    expect(terminalEnvironmentKey({ TERM: "xterm-256color", LANG: "C" })).not.toBe(before);
  });

  it("ignores environment key ORDER, which is not a change", () => {
    expect(terminalEnvironmentKey({ A: "1", B: "2" })).toBe(terminalEnvironmentKey({ B: "2", A: "1" }));
  });

  it("still reports a real tag change, including a reorder", () => {
    const before = terminalTagsKey(["prod", "db"]);

    expect(terminalTagsKey(["prod"])).not.toBe(before);
    // Order is significant: buildMockCommandResponse renders tags in order, so a
    // reorder is something the terminal should see.
    expect(terminalTagsKey(["db", "prod"])).not.toBe(before);
  });
});
