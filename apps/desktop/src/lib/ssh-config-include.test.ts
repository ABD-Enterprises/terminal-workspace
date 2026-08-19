import { describe, expect, it, vi } from "vitest";
import {
  resolveSshIncludes,
  type SshConfigFileReader,
  type SshConfigGlobLister,
} from "./ssh-config-include";

function fileReaderFromMap(files: Record<string, string>): SshConfigFileReader {
  return async (path: string) =>
    path in files
      ? { cycleKey: `test-cycle:${path}`, content: files[path] ?? "" }
      : null;
}

function globListerFromMap(matches: Record<string, string>): SshConfigGlobLister {
  return async () =>
    Object.entries(matches).map(([path, content]) => ({
      cycleKey: `test-cycle:${path}`,
      name: path.split("/").pop() ?? path,
      content,
    }));
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
    const readFile = vi.fn<SshConfigFileReader>(async () => ({
      cycleKey: "test-cycle:secret",
      content: "Host secret\n  HostName secret.example.com\n",
    }));

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
      .mockImplementationOnce(async () => ({
        cycleKey: "test-cycle:ok",
        content: "Host ok\n  HostName ok.example.com\n",
      }));

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

  it("retains the caller-visible glob parent in the nested reader path", async () => {
    const readFile = vi.fn(fileReaderFromMap({
      "~/.ssh/conf.d/nested/leaf": "Host leaf\n  HostName leaf.example.com\n",
    }));
    const globFiles = globListerFromMap({
      "~/.ssh/conf.d/00-root": "Include nested/leaf\n",
    });

    const { text, skipped } = await resolveSshIncludes("Include conf.d/*\n", {
      readFile,
      globFiles,
    });

    expect(skipped).toEqual([]);
    expect(text).toContain("Host leaf");
    expect(readFile).toHaveBeenCalledWith("~/.ssh/conf.d/nested/leaf", {
      parentCycleKey: "test-cycle:~/.ssh/conf.d/00-root",
      relativePath: "nested/leaf",
    });
  });

  it("collides two names for one cycle identity and names the skipped file", async () => {
    const readFile = vi.fn<SshConfigFileReader>(async () => null);
    const globFiles: SshConfigGlobLister = async (pattern) =>
      pattern.endsWith("/aliases/*")
        ? [{ cycleKey: "same-canonical-file", name: "20-alias", content: "Host second\n" }]
        : [
            {
              cycleKey: "same-canonical-file",
              name: "10-visible",
              content: "Include aliases/*\nHost first\n",
            },
          ];

    const { text, skipped } = await resolveSshIncludes("Include conf.d/*\n", {
      readFile,
      globFiles,
    });

    expect(text).toContain("Host first");
    expect(text).not.toContain("Host second");
    expect(skipped).toContainEqual({
      reason: "include-directive",
      detail: 'Include aliases/* matched file "20-alias" (cycle)',
    });
    expect(skipped[0]?.detail).not.toContain("same-canonical-file");
  });

  it("collides one file reached by a glob and a direct Include", async () => {
    const content = "Include ~/.ssh/conf.d/10-visible.conf\nHost shared\n";
    const readFile = vi.fn<SshConfigFileReader>(async (path) =>
      path === "~/.ssh/conf.d/10-visible.conf"
        ? { cycleKey: "same-canonical-file", content }
        : null
    );
    const globFiles: SshConfigGlobLister = async () => [
      {
        cycleKey: "same-canonical-file",
        name: "10-visible.conf",
        content,
      },
    ];

    const { text, skipped } = await resolveSshIncludes("Include conf.d/*\n", {
      readFile,
      globFiles,
      maxDepth: 3,
    });

    expect(text.match(/Host shared/g)).toHaveLength(1);
    expect(readFile).toHaveBeenCalledTimes(1);
    expect(skipped).toContainEqual({
      reason: "include-directive",
      detail: "Include ~/.ssh/conf.d/10-visible.conf (cycle)",
    });
  });

  it("resolves a relative Include beside a glob match's canonical symlink target", async () => {
    const readFile = vi.fn<SshConfigFileReader>(async (_path, context) => {
      return context?.parentCycleKey === "canonical-target-a" &&
        context.relativePath === "sibling.conf"
        ? {
            cycleKey: "canonical-sibling",
            content: "Host sibling\n  HostName sibling.example.com\n",
          }
        : null;
    });
    const globFiles: SshConfigGlobLister = async () => [
      {
        cycleKey: "canonical-target-a",
        name: "10.conf",
        content: "Include sibling.conf\nHost linked\n",
      },
    ];

    const { text, skipped } = await resolveSshIncludes("Include conf.d/*\n", {
      readFile,
      globFiles,
    });

    expect(skipped).toEqual([]);
    expect(text).toContain("Host sibling");
    expect(readFile).toHaveBeenCalledWith(
      "~/.ssh/conf.d/sibling.conf",
      {
        parentCycleKey: "canonical-target-a",
        relativePath: "sibling.conf",
      }
    );
  });

  it("resolves three relative levels beside a glob match's canonical symlink target", async () => {
    const visibleFragment = "~/.ssh/conf.d/10.conf";
    const symlinks = new Map([[visibleFragment, "~/.ssh/targets/a.conf"]]);
    const files = new Map([
      ["~/.ssh/targets/a.conf", "Include sibling.conf\n"],
      ["~/.ssh/targets/sibling.conf", "Include deeper.conf\n"],
      ["~/.ssh/targets/deeper.conf", "Host final-hop\n  HostName final.example.com\n"],
    ]);
    const canonicalByCycleKey = new Map<string, string>();
    const readCanonical = (canonicalPath: string) => {
      const content = files.get(canonicalPath);
      if (content === undefined) throw new Error(`unexpected canonical path: ${canonicalPath}`);
      const cycleKey = `test-cycle:${canonicalPath}`;
      canonicalByCycleKey.set(cycleKey, canonicalPath);
      return { cycleKey, content };
    };
    const globFiles: SshConfigGlobLister = async () => {
      const canonical = symlinks.get(visibleFragment);
      return canonical ? [{ ...readCanonical(canonical), name: "10.conf" }] : [];
    };
    const readFile = vi.fn<SshConfigFileReader>(async (_path, context) => {
      if (!context) return null;
      const parentCanonical = canonicalByCycleKey.get(context.parentCycleKey);
      if (!parentCanonical) return null;
      const parentDir = parentCanonical.slice(0, parentCanonical.lastIndexOf("/"));
      return readCanonical(`${parentDir}/${context.relativePath}`);
    });

    const { text, skipped } = await resolveSshIncludes("Include conf.d/*\n", {
      readFile,
      globFiles,
    });

    expect(skipped).toEqual([]);
    expect(text).toContain("Host final-hop");
    expect(readFile).toHaveBeenCalledTimes(2);
    expect(readFile).toHaveBeenNthCalledWith(1, "~/.ssh/conf.d/sibling.conf", {
      parentCycleKey: "test-cycle:~/.ssh/targets/a.conf",
      relativePath: "sibling.conf",
    });
    expect(readFile).toHaveBeenNthCalledWith(2, "~/.ssh/conf.d/deeper.conf", {
      parentCycleKey: "test-cycle:~/.ssh/targets/sibling.conf",
      relativePath: "deeper.conf",
    });
  });
});
