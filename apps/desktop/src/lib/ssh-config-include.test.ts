import { describe, expect, it, vi } from "vitest";
import {
  resolveSshIncludes,
  type SshConfigFileReader,
  type SshConfigGlobLister,
} from "./ssh-config-include";

function fileReaderFromMap(files: Record<string, string>): SshConfigFileReader {
  return async (path: string) => (path in files ? files[path] : null);
}

function globListerFromMap(matches: Record<string, string>): SshConfigGlobLister {
  return async () =>
    Object.entries(matches).map(([path, content]) => ({ path, content }));
}

describe("resolveSshIncludes", () => {
  it("inlines a single Include with absolute-style path", async () => {
    const readFile = fileReaderFromMap({
      "~/.ssh/work-config": "Host work\n  HostName work.example.com\n",
    });

    const { text, skipped } = await resolveSshIncludes(
      "Include ~/.ssh/work-config\n",
      { readFile }
    );

    expect(skipped).toEqual([]);
    expect(text).toContain("Host work");
    expect(text).toContain("HostName work.example.com");
  });

  it("resolves a relative Include path against the default ~/.ssh baseDir", async () => {
    const readFile = fileReaderFromMap({
      "~/.ssh/conf.d/work": "Host work\n  HostName work.example.com\n",
    });

    const { text, skipped } = await resolveSshIncludes("Include conf.d/work\n", {
      readFile,
    });

    expect(skipped).toEqual([]);
    expect(text).toContain("Host work");
  });

  it("expands nested Includes recursively", async () => {
    const readFile = fileReaderFromMap({
      "~/.ssh/level1": "Include level2\nHost level1\n  HostName l1.example.com\n",
      "~/.ssh/level2": "Host level2\n  HostName l2.example.com\n",
    });

    const { text, skipped } = await resolveSshIncludes("Include level1\n", {
      readFile,
    });

    expect(skipped).toEqual([]);
    expect(text).toContain("Host level1");
    expect(text).toContain("Host level2");
  });

  it("resolves nested relative Includes against the including file directory", async () => {
    const readFile = fileReaderFromMap({
      "~/.ssh/conf.d/root": "Include nested/leaf\n",
      "~/.ssh/conf.d/nested/leaf": "Host leaf\n  HostName leaf.example.com\n",
    });

    const { text, skipped } = await resolveSshIncludes("Include conf.d/root\n", {
      readFile,
    });

    expect(skipped).toEqual([]);
    expect(text).toContain("Host leaf");
  });

  it("does not expand Includes inside Host or Match blocks unconditionally", async () => {
    const readFile = vi.fn<SshConfigFileReader>(async () => "Host secret\n  HostName secret.example.com\n");

    const { text, skipped } = await resolveSshIncludes(
      "Host alpha\n  Include secret.conf\nMatch host beta\n  Include beta.conf\n",
      { readFile }
    );

    expect(readFile).not.toHaveBeenCalled();
    expect(text).not.toContain("Host secret");
    expect(skipped).toEqual([
      {
        reason: "include-directive",
        detail: "Include secret.conf (conditional block unsupported)",
      },
      {
        reason: "include-directive",
        detail: "Include beta.conf (conditional block unsupported)",
      },
    ]);
  });

  it("detects an Include cycle and logs a skip", async () => {
    const readFile = fileReaderFromMap({
      "~/.ssh/cycle-a": "Include cycle-b\n",
      "~/.ssh/cycle-b": "Include cycle-a\n",
    });

    const { skipped } = await resolveSshIncludes("Include cycle-a\n", {
      readFile,
    });

    expect(skipped).toContainEqual({
      reason: "include-directive",
      detail: expect.stringContaining("cycle"),
    });
  });

  it("rejects globs as unsupported and continues with the rest of the line", async () => {
    const readFile = fileReaderFromMap({
      "~/.ssh/specific": "Host specific\n  HostName s.example.com\n",
    });

    const { text, skipped } = await resolveSshIncludes(
      "Include conf.d/* specific\n",
      { readFile }
    );

    expect(skipped).toContainEqual({
      reason: "include-directive",
      detail: expect.stringContaining("glob unsupported"),
    });
    expect(text).toContain("Host specific");
  });

  it("logs a not-found skip when the readFile returns null", async () => {
    const readFile: SshConfigFileReader = async () => null;

    const { skipped } = await resolveSshIncludes("Include ~/.ssh/missing\n", {
      readFile,
    });

    expect(skipped).toContainEqual({
      reason: "include-directive",
      detail: expect.stringContaining("not found or rejected"),
    });
  });

  it("propagates a readFile thrown error as a logged skip without aborting the whole pass", async () => {
    const readFile = vi
      .fn<SshConfigFileReader>()
      .mockImplementationOnce(async () => {
        throw new Error("path not under ~/.ssh");
      })
      .mockImplementationOnce(async () => "Host ok\n  HostName ok.example.com\n");

    const { text, skipped } = await resolveSshIncludes(
      "Include ~/.ssh/forbidden\nInclude ~/.ssh/ok\n",
      { readFile }
    );

    expect(skipped).toContainEqual({
      reason: "include-directive",
      detail: expect.stringContaining("read error"),
    });
    expect(text).toContain("Host ok");
  });

  it("expands multiple paths on a single Include line", async () => {
    const readFile = fileReaderFromMap({
      "~/.ssh/a": "Host a\n  HostName a.example.com\n",
      "~/.ssh/b": "Host b\n  HostName b.example.com\n",
    });

    const { text, skipped } = await resolveSshIncludes(
      "Include a b\n",
      { readFile }
    );

    expect(skipped).toEqual([]);
    expect(text).toContain("Host a");
    expect(text).toContain("Host b");
  });

  it("respects a custom maxDepth and reports the limit hit", async () => {
    const readFile = fileReaderFromMap({
      "~/.ssh/L0": "Include L1\n",
      "~/.ssh/L1": "Include L2\n",
      "~/.ssh/L2": "Host L2\n  HostName l2.example.com\n",
    });

    const { skipped } = await resolveSshIncludes("Include L0\n", {
      readFile,
      maxDepth: 1,
    });

    expect(skipped).toContainEqual({
      reason: "include-directive",
      detail: expect.stringContaining("depth limit"),
    });
  });

  it("ignores commented-out Include lines", async () => {
    const readFile = vi.fn<SshConfigFileReader>(async () => null);

    const { text } = await resolveSshIncludes(
      "# Include should-not-resolve\n",
      { readFile }
    );

    // The parser handles comment skipping itself; resolveSshIncludes just has
    // to not eagerly fire readFile on a `#`-prefixed line. Verifying that.
    expect(readFile).not.toHaveBeenCalled();
    expect(text).toContain("# Include should-not-resolve");
  });

  it("skips a glob Include when no glob lister is supplied", async () => {
    const readFile = vi.fn<SshConfigFileReader>(async () => null);

    const { text, skipped } = await resolveSshIncludes("Include conf.d/*\n", {
      readFile,
    });

    expect(text).not.toContain("Host");
    expect(skipped).toContainEqual({
      reason: "include-directive",
      detail: expect.stringContaining("glob unsupported"),
    });
  });

  it("expands a glob Include to its matches in lexical order", async () => {
    const readFile = vi.fn<SshConfigFileReader>(async () => null);
    const globFiles = globListerFromMap({
      // Intentionally out of order to prove the resolver sorts by path.
      "~/.ssh/conf.d/20-prod": "Host prod\n  HostName prod.example.com\n",
      "~/.ssh/conf.d/10-staging": "Host staging\n  HostName staging.example.com\n",
    });

    const { text, skipped } = await resolveSshIncludes("Include conf.d/*\n", {
      readFile,
      globFiles,
    });

    expect(skipped).toEqual([]);
    expect(text).toContain("Host staging");
    expect(text).toContain("Host prod");
    // 10-staging sorts before 20-prod.
    expect(text.indexOf("Host staging")).toBeLessThan(text.indexOf("Host prod"));
  });

  it("logs a skip when a glob matches no files", async () => {
    const readFile = vi.fn<SshConfigFileReader>(async () => null);
    const globFiles: SshConfigGlobLister = async () => [];

    const { skipped } = await resolveSshIncludes("Include conf.d/*\n", {
      readFile,
      globFiles,
    });

    expect(skipped).toContainEqual({
      reason: "include-directive",
      detail: expect.stringContaining("no matching files"),
    });
  });

  it("recursively expands Includes found inside glob-matched files", async () => {
    const readFile = fileReaderFromMap({
      "~/.ssh/conf.d/base": "Host base\n  HostName base.example.com\n",
    });
    const globFiles = globListerFromMap({
      "~/.ssh/conf.d/00-root": "Include base\nHost root\n  HostName root.example.com\n",
    });

    const { text, skipped } = await resolveSshIncludes("Include conf.d/*\n", {
      readFile,
      globFiles,
    });

    expect(skipped).toEqual([]);
    expect(text).toContain("Host base");
    expect(text).toContain("Host root");
  });
});
