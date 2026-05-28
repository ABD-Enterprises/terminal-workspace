// Client-side validation for pasted private key bodies. T13.
//
// Used by the "Paste from clipboard" flow in KeyEditor to refuse
// obviously-wrong content (a copied password, a public key, an empty
// clipboard) before round-tripping to the backend writer.
//
// Recognized headers cover OpenSSH and the classic PEM private-key family.

const privateKeyBoundary = (kind: string, boundary: "BEGIN" | "END") => {
  const keyKind = kind ? `${kind} ` : "";
  return `-----${boundary} ${keyKind}PRIVATE KEY-----`;
};

const RECOGNIZED_PRIVATE_KEY_KINDS = ["OPENSSH", "RSA", "DSA", "EC", "ENCRYPTED", ""];

const RECOGNIZED_HEADERS = RECOGNIZED_PRIVATE_KEY_KINDS.map((kind) =>
  privateKeyBoundary(kind, "BEGIN")
);

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
