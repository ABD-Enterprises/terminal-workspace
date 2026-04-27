import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

// The backend auth module is plain ESM JS shipped with the Node backend; we
// load it via dynamic import so the test does not require a build step.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let authModule: any;

async function loadAuth() {
  if (!authModule) {
    authModule = await import("../../apps/desktop/server/auth.mjs");
  }
  return authModule;
}

const KNOWN_TOKEN = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

describe("backend auth helper", () => {
  describe("parseAllowedOrigins", () => {
    it("returns the default list when value is empty", async () => {
      const { parseAllowedOrigins, DEFAULT_ALLOWED_ORIGINS } = await loadAuth();
      expect(parseAllowedOrigins(undefined)).toEqual([...DEFAULT_ALLOWED_ORIGINS]);
      expect(parseAllowedOrigins("")).toEqual([...DEFAULT_ALLOWED_ORIGINS]);
      expect(parseAllowedOrigins("   ")).toEqual([...DEFAULT_ALLOWED_ORIGINS]);
    });

    it("splits a comma-separated value, trimming whitespace", async () => {
      const { parseAllowedOrigins } = await loadAuth();
      expect(
        parseAllowedOrigins(" http://a.test , http://b.test ,, http://c.test ")
      ).toEqual(["http://a.test", "http://b.test", "http://c.test"]);
    });

    it("falls back to defaults when only blank entries are supplied", async () => {
      const { parseAllowedOrigins, DEFAULT_ALLOWED_ORIGINS } = await loadAuth();
      expect(parseAllowedOrigins("  ,  ,  ")).toEqual([...DEFAULT_ALLOWED_ORIGINS]);
    });
  });

  describe("extractTokenFromHeaders", () => {
    it("reads X-Termsnip-Token", async () => {
      const { extractTokenFromHeaders } = await loadAuth();
      expect(extractTokenFromHeaders({ "x-termsnip-token": KNOWN_TOKEN })).toBe(KNOWN_TOKEN);
    });

    it("reads Authorization: Bearer <token>", async () => {
      const { extractTokenFromHeaders } = await loadAuth();
      expect(extractTokenFromHeaders({ authorization: `Bearer ${KNOWN_TOKEN}` })).toBe(
        KNOWN_TOKEN
      );
    });

    it("ignores non-bearer authorization schemes", async () => {
      const { extractTokenFromHeaders } = await loadAuth();
      expect(extractTokenFromHeaders({ authorization: `Basic ${KNOWN_TOKEN}` })).toBeUndefined();
    });

    it("returns undefined when no recognized header is present", async () => {
      const { extractTokenFromHeaders } = await loadAuth();
      expect(extractTokenFromHeaders({})).toBeUndefined();
      expect(extractTokenFromHeaders({ "x-other": "value" })).toBeUndefined();
    });

    it("returns undefined for null or wrong-shape inputs", async () => {
      const { extractTokenFromHeaders } = await loadAuth();
      expect(extractTokenFromHeaders(undefined)).toBeUndefined();
      expect(extractTokenFromHeaders(null)).toBeUndefined();
      expect(extractTokenFromHeaders("not an object")).toBeUndefined();
    });

    it("handles array-valued headers from Node IncomingMessage", async () => {
      const { extractTokenFromHeaders } = await loadAuth();
      expect(extractTokenFromHeaders({ "x-termsnip-token": [KNOWN_TOKEN] })).toBe(KNOWN_TOKEN);
    });
  });

  describe("safeStringEquals", () => {
    it("returns true for identical strings", async () => {
      const { safeStringEquals } = await loadAuth();
      expect(safeStringEquals("abc", "abc")).toBe(true);
    });

    it("returns false for different strings", async () => {
      const { safeStringEquals } = await loadAuth();
      expect(safeStringEquals("abc", "abd")).toBe(false);
    });

    it("returns false for length mismatch (does not throw)", async () => {
      const { safeStringEquals } = await loadAuth();
      expect(safeStringEquals("abc", "abcd")).toBe(false);
    });

    it("returns false for non-string inputs", async () => {
      const { safeStringEquals } = await loadAuth();
      expect(safeStringEquals(undefined, "abc")).toBe(false);
      expect(safeStringEquals("abc", undefined)).toBe(false);
      expect(safeStringEquals(123 as unknown as string, "123")).toBe(false);
    });
  });

  describe("isRequestAuthorized", () => {
    const ALLOWED = ["http://127.0.0.1:5173", "tauri://localhost"];

    it("accepts a request with a matching X-Termsnip-Token regardless of origin", async () => {
      const { isRequestAuthorized } = await loadAuth();
      const decision = isRequestAuthorized({
        headers: { "x-termsnip-token": KNOWN_TOKEN },
        allowedOrigins: ALLOWED,
        expectedToken: KNOWN_TOKEN,
      });
      expect(decision.ok).toBe(true);
      expect(decision.via).toBe("token");
    });

    it("accepts a request from an allowed Origin even without a token", async () => {
      const { isRequestAuthorized } = await loadAuth();
      const decision = isRequestAuthorized({
        headers: { origin: "http://127.0.0.1:5173" },
        allowedOrigins: ALLOWED,
        expectedToken: KNOWN_TOKEN,
      });
      expect(decision.ok).toBe(true);
      expect(decision.via).toBe("origin");
    });

    it("rejects when Origin is present but not in the allowlist", async () => {
      const { isRequestAuthorized } = await loadAuth();
      const decision = isRequestAuthorized({
        headers: { origin: "https://attacker.example" },
        allowedOrigins: ALLOWED,
        expectedToken: KNOWN_TOKEN,
      });
      expect(decision.ok).toBe(false);
      expect(decision.reason).toBe("origin-not-allowed");
    });

    it("rejects a token mismatch", async () => {
      const { isRequestAuthorized } = await loadAuth();
      const decision = isRequestAuthorized({
        headers: { "x-termsnip-token": "wrong-token-of-correct-shape-padding00000000000000000000" },
        allowedOrigins: ALLOWED,
        expectedToken: KNOWN_TOKEN,
      });
      expect(decision.ok).toBe(false);
      expect(decision.reason).toBe("token-mismatch");
    });

    it("rejects a request with neither Origin nor a token", async () => {
      const { isRequestAuthorized } = await loadAuth();
      const decision = isRequestAuthorized({
        headers: {},
        allowedOrigins: ALLOWED,
        expectedToken: KNOWN_TOKEN,
      });
      expect(decision.ok).toBe(false);
      expect(decision.reason).toBe("no-credentials");
    });

    it("rejects when the headers map is missing entirely", async () => {
      const { isRequestAuthorized } = await loadAuth();
      const decision = isRequestAuthorized({
        headers: undefined,
        allowedOrigins: ALLOWED,
        expectedToken: KNOWN_TOKEN,
      });
      expect(decision.ok).toBe(false);
      expect(decision.reason).toBe("missing-headers");
    });

    it("rejects when no expectedToken is set and origin is not in allowlist", async () => {
      // Documents the deny-by-default posture: even with no token configured,
      // an unknown origin must not be accepted.
      const { isRequestAuthorized } = await loadAuth();
      const decision = isRequestAuthorized({
        headers: { origin: "https://attacker.example" },
        allowedOrigins: ALLOWED,
        expectedToken: undefined,
      });
      expect(decision.ok).toBe(false);
      expect(decision.reason).toBe("origin-not-allowed");
    });

    it("ignores a Bearer token when no expectedToken is configured", async () => {
      // Token must be both present AND match an explicit expectedToken.
      const { isRequestAuthorized } = await loadAuth();
      const decision = isRequestAuthorized({
        headers: { authorization: `Bearer ${KNOWN_TOKEN}` },
        allowedOrigins: ALLOWED,
        expectedToken: undefined,
      });
      expect(decision.ok).toBe(false);
    });
  });

  describe("loadOrCreateBackendToken", () => {
    const created: string[] = [];

    afterEach(() => {
      while (created.length > 0) {
        const dir = created.pop();
        if (dir) {
          rmSync(dir, { recursive: true, force: true });
        }
      }
    });

    function makeTmpdir() {
      const dir = mkdtempSync(join(tmpdir(), "termsnip-auth-test-"));
      created.push(dir);
      return dir;
    }

    it("uses TERMSNIP_BACKEND_TOKEN when set", async () => {
      const { loadOrCreateBackendToken } = await loadAuth();
      const dir = makeTmpdir();
      const result = loadOrCreateBackendToken({
        port: 18790,
        env: { TERMSNIP_BACKEND_TOKEN: KNOWN_TOKEN },
        tmpdir: dir,
      });
      expect(result.token).toBe(KNOWN_TOKEN);
      expect(result.source).toBe("env");
    });

    it("rejects an env token shorter than 32 chars and falls through", async () => {
      const { loadOrCreateBackendToken } = await loadAuth();
      const dir = makeTmpdir();
      const result = loadOrCreateBackendToken({
        port: 18791,
        env: { TERMSNIP_BACKEND_TOKEN: "tooshort" },
        tmpdir: dir,
      });
      expect(result.source).toBe("generated");
      expect(result.token.length).toBeGreaterThanOrEqual(32);
    });

    it("reads an existing sidecar file when env is missing", async () => {
      const { loadOrCreateBackendToken } = await loadAuth();
      const dir = makeTmpdir();
      const sidecar = join(dir, "termsnip-backend.18792.token");
      writeFileSync(sidecar, `${KNOWN_TOKEN}\n`, { mode: 0o600 });
      const result = loadOrCreateBackendToken({
        port: 18792,
        env: {},
        tmpdir: dir,
      });
      expect(result.token).toBe(KNOWN_TOKEN);
      expect(result.source).toBe("sidecar");
    });

    it("generates and persists a new token when no source has one", async () => {
      const { loadOrCreateBackendToken } = await loadAuth();
      const dir = makeTmpdir();
      const result = loadOrCreateBackendToken({
        port: 18793,
        env: {},
        tmpdir: dir,
      });
      expect(result.token).toMatch(/^[0-9a-f]{64}$/);
      expect(result.source).toBe("generated");
      expect(readFileSync(result.sidecarPath, "utf8").trim()).toBe(result.token);
      // Sidecar must be 0600 — owner read/write only. Other-bits must be 0.
      const stats = statSync(result.sidecarPath);
      const otherPerms = stats.mode & 0o077;
      expect(otherPerms).toBe(0);
    });
  });
});
