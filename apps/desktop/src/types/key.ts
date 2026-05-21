export type KeyAlgorithm = "ED25519" | "ECDSA" | "RSA" | "UNKNOWN";
export type KeySource = "imported" | "generated";
export type KeyGenerationType = "ed25519" | "ecdsa" | "rsa";

export interface KeyRecord {
  id: string;
  label: string;
  algorithm: KeyAlgorithm;
  bits: number;
  fingerprint: string;
  comment: string;
  privateKeyPath: string;
  publicKeyPath?: string;
  source: KeySource;
  hasPassphrase: boolean;
  assignedHostIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface KeyMetadata {
  algorithm: KeyAlgorithm;
  bits: number;
  fingerprint: string;
  comment: string;
  privateKeyPath: string;
  publicKeyPath?: string;
}

export interface ImportKeyValues {
  label: string;
  privateKeyPath: string;
  hasPassphrase: boolean;
  /**
   * T13: when non-empty, the import flow writes this body to
   * `privateKeyPath` (with 0600 perms) before running the inspect
   * step. Lets the user paste a key body from clipboard / a password
   * manager rather than going through the file picker.
   */
  pastedKeyBody: string;
}

export interface GenerateKeyValues {
  label: string;
  privateKeyPath: string;
  passphrase: string;
  comment: string;
  type: KeyGenerationType;
}

export const emptyImportKeyValues: ImportKeyValues = {
  label: "",
  privateKeyPath: "~/.ssh/id_ed25519",
  hasPassphrase: false,
  pastedKeyBody: "",
};

export const emptyGenerateKeyValues: GenerateKeyValues = {
  label: "",
  privateKeyPath: "~/.ssh/termsnip_ed25519",
  passphrase: "",
  comment: "termsnip@local",
  type: "ed25519",
};

export const sampleKeys: KeyRecord[] = [
  {
    id: "key-prod-ed25519",
    label: "MacBook Pro ED25519",
    algorithm: "ED25519",
    bits: 256,
    fingerprint: "SHA256:prodGatewayDemoKey",
    comment: "ops@macbook-pro",
    privateKeyPath: "~/.ssh/id_ed25519",
    publicKeyPath: "~/.ssh/id_ed25519.pub",
    source: "imported",
    hasPassphrase: true,
    assignedHostIds: ["prod-gateway"],
    createdAt: "2026-03-20T12:00:00.000Z",
    updatedAt: "2026-03-29T11:10:00.000Z",
  },
  {
    id: "key-deploy-shared",
    label: "Deploy Shared Key",
    algorithm: "ED25519",
    bits: 256,
    fingerprint: "SHA256:billingDeployDemo",
    comment: "deploy@billing-api",
    privateKeyPath: "~/.ssh/deploy_key",
    publicKeyPath: "~/.ssh/deploy_key.pub",
    source: "imported",
    hasPassphrase: false,
    assignedHostIds: ["billing-api"],
    createdAt: "2026-03-18T08:30:00.000Z",
    updatedAt: "2026-03-28T20:12:00.000Z",
  },
];
