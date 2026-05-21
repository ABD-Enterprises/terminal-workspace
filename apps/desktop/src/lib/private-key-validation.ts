// Client-side validation for pasted private key bodies. T13.
//
// Used by the "Paste from clipboard" flow in KeyEditor to refuse
// obviously-wrong content (a copied password, a public key, an empty
// clipboard) before round-tripping to the backend writer.
//
// Recognized headers cover the full OpenSSH / classic PEM family:
//   -----BEGIN OPENSSH PRIVATE KEY-----   (modern OpenSSH)
//   -----BEGIN RSA PRIVATE KEY-----        (PKCS#1 RSA)
//   -----BEGIN DSA PRIVATE KEY-----        (legacy DSA)
//   -----BEGIN EC PRIVATE KEY-----         (SEC1 ECDSA)
//   -----BEGIN ENCRYPTED PRIVATE KEY-----  (PKCS#8 encrypted)
//   -----BEGIN PRIVATE KEY-----            (PKCS#8 unencrypted)

const RECOGNIZED_HEADERS = [
  "-----BEGIN OPENSSH PRIVATE KEY-----",
  "-----BEGIN RSA PRIVATE KEY-----",
  "-----BEGIN DSA PRIVATE KEY-----",
  "-----BEGIN EC PRIVATE KEY-----",
  "-----BEGIN ENCRYPTED PRIVATE KEY-----",
  "-----BEGIN PRIVATE KEY-----",
];

const FOOTER_RE = /-----END [A-Z ]*PRIVATE KEY-----/;

export interface PrivateKeyValidationResult {
  ok: boolean;
  /** When ok=false, a short human-readable reason. */
  reason?: string;
}

export function validatePastedPrivateKey(body: string): PrivateKeyValidationResult {
  const trimmed = body.trim();
  if (trimmed.length === 0) {
    return { ok: false, reason: "Clipboard is empty." };
  }
  const matchedHeader = RECOGNIZED_HEADERS.find((header) => trimmed.startsWith(header));
  if (!matchedHeader) {
    return {
      ok: false,
      reason:
        "Pasted content does not start with a recognized PEM private key header (-----BEGIN ... PRIVATE KEY-----).",
    };
  }
  if (!FOOTER_RE.test(trimmed)) {
    return {
      ok: false,
      reason:
        "Pasted content is missing the matching -----END PRIVATE KEY----- footer.",
    };
  }
  return { ok: true };
}
