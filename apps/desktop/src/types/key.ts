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
};

export const emptyGenerateKeyValues: GenerateKeyValues = {
  label: "",
  privateKeyPath: "~/.ssh/termsnip_ed25519",
  passphrase: "",
  comment: "termsnip@local",
  type: "ed25519",
};
