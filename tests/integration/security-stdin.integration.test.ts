import { spawnSync } from "node:child_process";
import { chmodSync, closeSync, fstatSync, mkdtempSync, openSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { encodeSecurityCommand, runSigningCommand } from "../../scripts/security-stdin.mjs";

const env = {
  PATH: "/fixture/bin",
  MACOS_KEYCHAIN_PASSWORD: 'fixture key\\"pass',
  MACOS_CERTIFICATE_PASSWORD: "fixture-cert-password",
  MACOS_CERTIFICATE_P12_BASE64: "fixture-base64",
};

describe("release signing input pipe", () => {
  it.each([
    ["create-keychain", ["/fixture/keychain"], env.MACOS_KEYCHAIN_PASSWORD],
    ["unlock-keychain", ["/fixture/keychain"], env.MACOS_KEYCHAIN_PASSWORD],
    ["import", ["/fixture/certificate.p12", "/fixture/keychain"], env.MACOS_CERTIFICATE_PASSWORD],
    ["set-key-partition-list", ["/fixture/keychain"], env.MACOS_KEYCHAIN_PASSWORD],
  ])("keeps %s passwords out of process arguments and child environment", (operation, paths, password) => {
    const spawn = vi.fn(() => ({ status: 0 }));
    runSigningCommand(operation, paths, { env, spawn });
    const [executable, args, options] = spawn.mock.calls[0];
    expect(executable).toBe("/usr/bin/security");
    expect(args).toEqual(["-i"]);
    expect(options.env).toEqual({ PATH: env.PATH });
    expect(options.input).toContain(encodeSecurityCommand([password]).trim());
    expect(options.input.split("\n")).toHaveLength(2);
    expect(options.timeout).toBeGreaterThan(0);
  });

  it.each(["bad\nhelp", "bad\rhelp", "bad\0value", "x".repeat(4000), "🔒".repeat(1000)])(
    "refuses input that could split or truncate the command",
    (password) => {
      const spawn = vi.fn();
      expect(() => runSigningCommand("create-keychain", ["/fixture/keychain"], {
        env: { ...env, MACOS_KEYCHAIN_PASSWORD: password }, spawn,
      })).toThrow();
      expect(spawn).not.toHaveBeenCalled();
    }
  );

  it.each([{ status: 1 }, { status: null }, { status: 0, error: new Error("fixture-secret") }])(
    "fails closed without forwarding command output",
    (result) => {
      const spawn = vi.fn(() => ({ ...result, stdout: "fixture-secret", stderr: "fixture-secret" }));
      expect(() => runSigningCommand("import", ["/fixture/cert", "/fixture/keychain"], { env, spawn }))
        .toThrow(/^macOS signing setup failed during import\.$/u);
    }
  );

  it("rejects unsupported operations and missing secrets before spawning", () => {
    const spawn = vi.fn();
    expect(() => runSigningCommand("delete-keychain", ["/fixture/keychain"], { env, spawn })).toThrow();
    expect(() => runSigningCommand("import", ["/fixture/cert", "/fixture/keychain"], { env: {}, spawn })).toThrow();
    expect(spawn).not.toHaveBeenCalled();
  });

  it.runIf(process.platform === "darwin")("preserves quoted values in Apple's parser using read-only help", () => {
    const value = 'fixture value "quote" \\ slash; $()';
    const result = spawnSync("/usr/bin/security", ["-i"], {
      input: encodeSecurityCommand(["help", value]), encoding: "utf8", timeout: 20_000,
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`no such command: ${value}`);
  }, 30_000);

  it("writes the workflow certificate privately and refuses existing files or links", () => {
    const workflow = readFileSync(".github/workflows/release-macos.yml", "utf8");
    const block = workflow.split("python3 <<'PY'\n")[1].split("          PY\n")[0];
    const script = block.split("\n").map((line) => line.replace(/^ {10}/u, "")).join("\n");
    const directory = mkdtempSync(join(tmpdir(), "tw-certificate-test-"));
    const path = join(directory, "certificate.p12");
    const run = () => spawnSync("python3", ["-c", script], {
      env: { ...process.env, CERT_PATH: path, MACOS_CERTIFICATE_P12_BASE64: Buffer.from("fixture-certificate").toString("base64") },
      encoding: "utf8", timeout: 20_000,
    });
    try {
      expect(run().status).toBe(0);
      const descriptor = openSync(path, "r");
      try {
        expect(fstatSync(descriptor).mode & 0o777).toBe(0o600);
        expect(readFileSync(descriptor, "utf8")).toBe("fixture-certificate");
      } finally {
        closeSync(descriptor);
      }
      writeFileSync(path, "existing-file");
      chmodSync(path, 0o644);
      expect(run().status).not.toBe(0);
      expect(readFileSync(path, "utf8")).toBe("existing-file");
      rmSync(path);
      const target = join(directory, "target");
      writeFileSync(target, "untouched");
      symlinkSync(target, path);
      expect(run().status).not.toBe(0);
      expect(readFileSync(target, "utf8")).toBe("untouched");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }, 60_000);
});
