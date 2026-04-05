import type { LocalConfigBundle, LocalConfigImportStrategy } from "./local-config";

export interface VaultSyncCountSummary {
  hosts: number;
  keys: number;
  snippets: number;
  knownHosts: number;
}

export interface VaultSyncEnvelopeHeader {
  schema: "termsnip-vault-sync";
  version: 1;
  payloadKind: "local-config-bundle";
  vaultId: string;
  sourceDeviceId: string;
  snapshotId: string;
  baseSnapshotId: string | null;
  exportedAt: string;
  recordCounts: VaultSyncCountSummary;
  deletionCounts: VaultSyncCountSummary;
}

export interface VaultSyncCipherPayload {
  algorithm: "AES-256-GCM";
  keyId: string;
  nonce: string;
  ciphertext: string;
  authTag: string;
}

export interface VaultSyncEnvelope {
  header: VaultSyncEnvelopeHeader;
  cipher: VaultSyncCipherPayload;
  digest: {
    algorithm: "SHA-256";
    value: string;
  };
}

export interface VaultSyncLocalContext {
  vaultId: string;
  lastAppliedSnapshotId: string | null;
}

export interface VaultSyncEnvelopeAnalysis {
  strategy: LocalConfigImportStrategy;
  digestMatches: boolean;
  header: VaultSyncEnvelopeHeader;
}

export interface VaultSyncTrustedKey {
  keyId: string;
  algorithm: VaultSyncCipherPayload["algorithm"];
  validFrom: string;
  rotateAfter: string | null;
  retireAfter: string | null;
  allowedVaultIds: string[] | null;
  replacementKeyIds: string[];
}

export interface VaultSyncTrustPolicy {
  schema: "termsnip-vault-sync-trust";
  version: 1;
  allowUnknownKeys: boolean;
  trustedKeys: VaultSyncTrustedKey[];
}

export interface VaultSyncTrustAnalysis {
  accepted: boolean;
  status:
    | "active"
    | "rotating"
    | "retired"
    | "not_yet_valid"
    | "unknown"
    | "vault_mismatch"
    | "algorithm_mismatch";
  matchedKeyId: string | null;
  replacementKeyIds: string[];
  reason: string | null;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isCountSummary(value: unknown): value is VaultSyncCountSummary {
  return (
    isRecord(value) &&
    typeof value.hosts === "number" &&
    typeof value.keys === "number" &&
    typeof value.snippets === "number" &&
    typeof value.knownHosts === "number"
  );
}

function isCipherPayload(value: unknown): value is VaultSyncCipherPayload {
  return (
    isRecord(value) &&
    value.algorithm === "AES-256-GCM" &&
    typeof value.keyId === "string" &&
    typeof value.nonce === "string" &&
    typeof value.ciphertext === "string" &&
    typeof value.authTag === "string"
  );
}

function isEnvelopeHeader(value: unknown): value is VaultSyncEnvelopeHeader {
  return (
    isRecord(value) &&
    value.schema === "termsnip-vault-sync" &&
    value.version === 1 &&
    value.payloadKind === "local-config-bundle" &&
    typeof value.vaultId === "string" &&
    typeof value.sourceDeviceId === "string" &&
    typeof value.snapshotId === "string" &&
    (typeof value.baseSnapshotId === "string" || value.baseSnapshotId === null) &&
    typeof value.exportedAt === "string" &&
    isCountSummary(value.recordCounts) &&
    isCountSummary(value.deletionCounts)
  );
}

function isTrustedKey(value: unknown): value is VaultSyncTrustedKey {
  return (
    isRecord(value) &&
    typeof value.keyId === "string" &&
    value.algorithm === "AES-256-GCM" &&
    typeof value.validFrom === "string" &&
    (typeof value.rotateAfter === "string" || value.rotateAfter === null) &&
    (typeof value.retireAfter === "string" || value.retireAfter === null) &&
    (value.allowedVaultIds === null || isStringArray(value.allowedVaultIds)) &&
    isStringArray(value.replacementKeyIds)
  );
}

function countBundleRecords(bundle: LocalConfigBundle): VaultSyncCountSummary {
  return {
    hosts: bundle.hosts.length,
    keys: bundle.keys.length,
    snippets: bundle.snippets.length,
    knownHosts: bundle.knownHosts.length,
  };
}

function countBundleDeletions(bundle: LocalConfigBundle): VaultSyncCountSummary {
  return {
    hosts: bundle.deletions.hosts.length,
    keys: bundle.deletions.keys.length,
    snippets: bundle.deletions.snippets.length,
    knownHosts: bundle.deletions.knownHosts.length,
  };
}

function createDigestMaterial(header: VaultSyncEnvelopeHeader, cipher: VaultSyncCipherPayload) {
  return [
    header.schema,
    String(header.version),
    header.payloadKind,
    header.vaultId,
    header.sourceDeviceId,
    header.snapshotId,
    header.baseSnapshotId ?? "",
    header.exportedAt,
    [
      header.recordCounts.hosts,
      header.recordCounts.keys,
      header.recordCounts.snippets,
      header.recordCounts.knownHosts,
    ].join(":"),
    [
      header.deletionCounts.hosts,
      header.deletionCounts.keys,
      header.deletionCounts.snippets,
      header.deletionCounts.knownHosts,
    ].join(":"),
    cipher.algorithm,
    cipher.keyId,
    cipher.nonce,
    cipher.ciphertext,
    cipher.authTag,
  ].join("|");
}

async function sha256Hex(value: string) {
  const bytes = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function classifyVaultSyncStrategy(
  header: VaultSyncEnvelopeHeader,
  localContext: VaultSyncLocalContext
): LocalConfigImportStrategy {
  if (header.snapshotId === localContext.lastAppliedSnapshotId) {
    return "same_snapshot";
  }

  if (header.vaultId !== localContext.vaultId) {
    return "adopt_vault";
  }

  if (
    localContext.lastAppliedSnapshotId &&
    header.baseSnapshotId === localContext.lastAppliedSnapshotId
  ) {
    return "fast_forward";
  }

  return "divergent";
}

export async function buildVaultSyncEnvelope(
  bundle: LocalConfigBundle,
  cipher: VaultSyncCipherPayload
): Promise<VaultSyncEnvelope> {
  const header: VaultSyncEnvelopeHeader = {
    schema: "termsnip-vault-sync",
    version: 1,
    payloadKind: "local-config-bundle",
    vaultId: bundle.vault.vaultId,
    sourceDeviceId: bundle.vault.sourceDeviceId,
    snapshotId: bundle.vault.snapshotId,
    baseSnapshotId: bundle.vault.baseSnapshotId,
    exportedAt: bundle.exportedAt,
    recordCounts: countBundleRecords(bundle),
    deletionCounts: countBundleDeletions(bundle),
  };
  const digest = await sha256Hex(createDigestMaterial(header, cipher));

  return {
    header,
    cipher,
    digest: {
      algorithm: "SHA-256",
      value: digest,
    },
  };
}

export async function inspectVaultSyncEnvelope(
  value: unknown,
  localContext: VaultSyncLocalContext
): Promise<VaultSyncEnvelopeAnalysis> {
  const envelope = parseVaultSyncEnvelope(value);

  const expectedDigest = await sha256Hex(createDigestMaterial(envelope.header, envelope.cipher));

  return {
    strategy: classifyVaultSyncStrategy(envelope.header, localContext),
    digestMatches: expectedDigest === envelope.digest.value,
    header: envelope.header,
  };
}

export function parseVaultSyncEnvelope(value: unknown): VaultSyncEnvelope {
  if (!isRecord(value) || !isEnvelopeHeader(value.header) || !isCipherPayload(value.cipher)) {
    throw new Error("Vault sync envelope is invalid.");
  }

  if (
    !isRecord(value.digest) ||
    value.digest.algorithm !== "SHA-256" ||
    typeof value.digest.value !== "string"
  ) {
    throw new Error("Vault sync envelope digest is invalid.");
  }

  return value as unknown as VaultSyncEnvelope;
}

export function parseVaultSyncTrustPolicy(value: unknown): VaultSyncTrustPolicy {
  if (
    !isRecord(value) ||
    value.schema !== "termsnip-vault-sync-trust" ||
    value.version !== 1 ||
    typeof value.allowUnknownKeys !== "boolean" ||
    !Array.isArray(value.trustedKeys) ||
    !value.trustedKeys.every((entry) => isTrustedKey(entry))
  ) {
    throw new Error("Vault sync trust policy is invalid.");
  }

  return value as unknown as VaultSyncTrustPolicy;
}

export function evaluateVaultSyncEnvelopeTrust(
  envelope: VaultSyncEnvelope,
  policy: VaultSyncTrustPolicy,
  now = envelope.header.exportedAt
): VaultSyncTrustAnalysis {
  const matchedKey =
    policy.trustedKeys.find((entry) => entry.keyId === envelope.cipher.keyId) ?? null;

  if (!matchedKey) {
    return {
      accepted: policy.allowUnknownKeys,
      status: "unknown",
      matchedKeyId: null,
      replacementKeyIds: [],
      reason: policy.allowUnknownKeys
        ? "Envelope key is unknown but the policy allows unknown keys."
        : "Envelope key is not trusted by the local sync policy.",
    };
  }

  if (matchedKey.algorithm !== envelope.cipher.algorithm) {
    return {
      accepted: false,
      status: "algorithm_mismatch",
      matchedKeyId: matchedKey.keyId,
      replacementKeyIds: matchedKey.replacementKeyIds,
      reason: "Envelope algorithm does not match the trusted key record.",
    };
  }

  if (matchedKey.allowedVaultIds && !matchedKey.allowedVaultIds.includes(envelope.header.vaultId)) {
    return {
      accepted: false,
      status: "vault_mismatch",
      matchedKeyId: matchedKey.keyId,
      replacementKeyIds: matchedKey.replacementKeyIds,
      reason: "Envelope vault is not allowed for the trusted key record.",
    };
  }

  if (envelope.header.exportedAt < matchedKey.validFrom) {
    return {
      accepted: false,
      status: "not_yet_valid",
      matchedKeyId: matchedKey.keyId,
      replacementKeyIds: matchedKey.replacementKeyIds,
      reason: "Envelope was exported before the trusted key became valid.",
    };
  }

  if (matchedKey.retireAfter && envelope.header.exportedAt > matchedKey.retireAfter) {
    return {
      accepted: false,
      status: "retired",
      matchedKeyId: matchedKey.keyId,
      replacementKeyIds: matchedKey.replacementKeyIds,
      reason: "Envelope was exported after the trusted key retirement time.",
    };
  }

  if (matchedKey.rotateAfter && now >= matchedKey.rotateAfter) {
    return {
      accepted: true,
      status: "rotating",
      matchedKeyId: matchedKey.keyId,
      replacementKeyIds: matchedKey.replacementKeyIds,
      reason: "Envelope is still valid, but the trusted key should be rotated.",
    };
  }

  return {
    accepted: true,
    status: "active",
    matchedKeyId: matchedKey.keyId,
    replacementKeyIds: matchedKey.replacementKeyIds,
    reason: null,
  };
}
