import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import {
  ALL_RELEASE_SECRET_NAMES,
  applyReleaseSecretsFromEnv,
  auditReleaseSecrets,
  parseSecretListOutput,
  validateLocalReleaseSecrets,
} from "../../scripts/github-release-secrets.mjs";

const tempDirs: string[] = [];

afterEach(() => {
  for (const directory of tempDirs.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

function makeTempFile(name: string, contents: string) {
  const directory = mkdtempSync(join(tmpdir(), "termsnip-release-secrets-"));
  tempDirs.push(directory);
  const filePath = join(directory, name);
  writeFileSync(filePath, contents);
  return filePath;
}

describe("github release secrets tooling", () => {
  it("parses GitHub secret list output into a stable secret set", () => {
    const parsed = parseSecretListOutput(
      [
        "MACOS_CERTIFICATE_P12_BASE64\t2026-04-04T18:00:00Z\tselected",
        "MACOS_SIGN_IDENTITY 2026-04-04T18:00:00Z updated",
        "",
      ].join("\n"),
    );

    expect(parsed).toEqual(
      new Set(["MACOS_CERTIFICATE_P12_BASE64", "MACOS_SIGN_IDENTITY"]),
    );
  });

  it("validates local signing and notary candidates from direct environment values", () => {
    const validation = validateLocalReleaseSecrets({
      env: {
        MACOS_CERTIFICATE_P12_BASE64: "ZmFrZS1wMTI=",
        MACOS_CERTIFICATE_PASSWORD: "certificate-password",
        MACOS_KEYCHAIN_PASSWORD: "keychain-password",
        MACOS_SIGN_IDENTITY: "Developer ID Application: ABD Enterprises, Inc. (2R4WAH4R53)",
        MACOS_NOTARY_KEY_ID: "ABC123DEF4",
        MACOS_NOTARY_ISSUER: "11111111-2222-3333-4444-555555555555",
        MACOS_NOTARY_KEY_BASE64: "ZmFrZS1wOA==",
      },
      detectIdentity: () => "",
    });

    expect(validation.ready).toBe(true);
    expect(validation.notaryMode).toBe("api-key");
    expect(validation.missingSigning).toEqual([]);
    expect(validation.missingNotary).toEqual([]);
    expect(validation.present).toEqual([
      "MACOS_CERTIFICATE_P12_BASE64",
      "MACOS_CERTIFICATE_PASSWORD",
      "MACOS_KEYCHAIN_PASSWORD",
      "MACOS_SIGN_IDENTITY",
      "MACOS_NOTARY_KEY_ID",
      "MACOS_NOTARY_ISSUER",
      "MACOS_NOTARY_KEY_BASE64",
    ]);
  });

  it("audits repo secrets against local file-backed candidates", () => {
    const certificatePath = makeTempFile("signing.p12", "fake-p12-bytes");
    const notaryKeyPath = makeTempFile("AuthKey_TEST.p8", "fake-p8-bytes");

    const audit = auditReleaseSecrets({
      repo: "deffenda/term-snip",
      env: {
        MACOS_CERTIFICATE_P12_PATH: certificatePath,
        MACOS_CERTIFICATE_PASSWORD: "certificate-password",
        MACOS_KEYCHAIN_PASSWORD: "keychain-password",
        MACOS_NOTARY_KEY_ID: "ABC123DEF4",
        MACOS_NOTARY_ISSUER: "11111111-2222-3333-4444-555555555555",
        MACOS_NOTARY_KEY_PATH: notaryKeyPath,
      },
      runSecretList: () => [
        "MACOS_CERTIFICATE_PASSWORD 2026-04-04T18:00:00Z selected",
        "MACOS_KEYCHAIN_PASSWORD 2026-04-04T18:00:00Z selected",
      ].join("\n"),
      detectIdentity: () => "Developer ID Application: ABD Enterprises, Inc. (2R4WAH4R53)",
    });

    expect(audit.repo).toBe("deffenda/term-snip");
    expect(audit.github.ready).toBe(false);
    expect(audit.github.missingSigning).toEqual([
      "MACOS_CERTIFICATE_P12_BASE64",
      "MACOS_SIGN_IDENTITY",
    ]);
    expect(audit.local.ready).toBe(true);
    expect(audit.local.notaryMode).toBe("api-key");
  });

  it("applies all required secrets from local candidates", () => {
    const applied: Array<{ name: string; value: string }> = [];

    const result = applyReleaseSecretsFromEnv({
      repo: "deffenda/term-snip",
      env: {
        MACOS_CERTIFICATE_P12_BASE64: "ZmFrZS1wMTI=",
        MACOS_CERTIFICATE_PASSWORD: "certificate-password",
        MACOS_KEYCHAIN_PASSWORD: "keychain-password",
        MACOS_SIGN_IDENTITY: "Developer ID Application: ABD Enterprises, Inc. (2R4WAH4R53)",
        MACOS_NOTARY_APPLE_ID: "release@example.com",
        MACOS_NOTARY_APP_PASSWORD: "app-password",
        MACOS_NOTARY_TEAM_ID: "2R4WAH4R53",
      },
      setSecret: (_repo, name, value) => {
        applied.push({ name, value });
        return "";
      },
      detectIdentity: () => "",
    });

    expect(result.repo).toBe("deffenda/term-snip");
    expect(result.notaryMode).toBe("apple-id");
    expect(result.appliedNames).toEqual([
      "MACOS_CERTIFICATE_P12_BASE64",
      "MACOS_CERTIFICATE_PASSWORD",
      "MACOS_KEYCHAIN_PASSWORD",
      "MACOS_SIGN_IDENTITY",
      "MACOS_NOTARY_APPLE_ID",
      "MACOS_NOTARY_APP_PASSWORD",
      "MACOS_NOTARY_TEAM_ID",
    ]);
    expect(applied).toHaveLength(result.appliedNames.length);
    expect(applied.map((entry) => entry.name)).toEqual(result.appliedNames);
  });

  it("supports dry-run application without invoking gh secret writes", () => {
    const result = applyReleaseSecretsFromEnv({
      repo: "deffenda/term-snip",
      dryRun: true,
      env: {
        MACOS_CERTIFICATE_P12_BASE64: "ZmFrZS1wMTI=",
        MACOS_CERTIFICATE_PASSWORD: "certificate-password",
        MACOS_KEYCHAIN_PASSWORD: "keychain-password",
        MACOS_SIGN_IDENTITY: "Developer ID Application: ABD Enterprises, Inc. (2R4WAH4R53)",
        MACOS_NOTARY_KEY_ID: "ABC123DEF4",
        MACOS_NOTARY_ISSUER: "11111111-2222-3333-4444-555555555555",
        MACOS_NOTARY_KEY_BASE64: "ZmFrZS1wOA==",
      },
      setSecret: () => {
        throw new Error("setSecret should not be called in dry-run mode");
      },
      detectIdentity: () => "",
    });

    expect(result.dryRun).toBe(true);
    expect(result.appliedNames).toEqual([
      "MACOS_CERTIFICATE_P12_BASE64",
      "MACOS_CERTIFICATE_PASSWORD",
      "MACOS_KEYCHAIN_PASSWORD",
      "MACOS_SIGN_IDENTITY",
      "MACOS_NOTARY_KEY_ID",
      "MACOS_NOTARY_ISSUER",
      "MACOS_NOTARY_KEY_BASE64",
    ]);
  });

  it("fails apply-env when the local environment cannot satisfy the signing contract", () => {
    expect(() =>
      applyReleaseSecretsFromEnv({
        repo: "deffenda/term-snip",
        env: {},
        detectIdentity: () => "",
      }),
    ).toThrow(/Cannot apply release secrets from local environment/);
  });

  it("keeps the exported release secret universe stable", () => {
    expect(ALL_RELEASE_SECRET_NAMES).toEqual([
      "MACOS_CERTIFICATE_P12_BASE64",
      "MACOS_CERTIFICATE_PASSWORD",
      "MACOS_KEYCHAIN_PASSWORD",
      "MACOS_SIGN_IDENTITY",
      "MACOS_NOTARY_KEY_ID",
      "MACOS_NOTARY_ISSUER",
      "MACOS_NOTARY_KEY_BASE64",
      "MACOS_NOTARY_APPLE_ID",
      "MACOS_NOTARY_APP_PASSWORD",
      "MACOS_NOTARY_TEAM_ID",
    ]);
  });
});
