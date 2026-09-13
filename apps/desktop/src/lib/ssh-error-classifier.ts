// Classify raw ssh2 / OpenSSH error strings into user-facing categories
// with actionable hints. T16.
//
// The classifier is intentionally a flat pattern-match over known
// strings — ssh2's errors are stable enough that regex matching beats
// trying to read error.code (which is missing or generic for most
// auth-layer failures).

export type SshErrorCategory =
  | "auth_failed"
  | "host_key_mismatch"
  | "network_unreachable"
  | "timeout"
  | "refused"
  | "dns_failure"
  | "unknown";

export interface ClassifiedSshError {
  category: SshErrorCategory;
  /** Short user-facing message — fits in a banner without wrapping. */
  message: string;
  /** Actionable suggestion. Always present for non-"unknown" categories. */
  hint?: string;
  /** Original raw error string for diagnostics. */
  raw: string;
}

interface ClassifierRule {
  category: SshErrorCategory;
  match: RegExp;
  message: string;
  hint: string;
}

const RULES: ClassifierRule[] = [
  // Authentication failures — ssh2 surfaces a few flavors.
  {
    category: "auth_failed",
    match: /All configured authentication methods failed/i,
    message: "Authentication failed.",
    hint:
      "Check the username, key path, and passphrase. If you're using a key, make sure the matching public key is in the remote ~/.ssh/authorized_keys.",
  },
  {
    category: "auth_failed",
    match: /Permission denied \(publickey/i,
    message: "Server rejected the public key.",
    hint:
      "Install your public key on the host (use the Copy to host… action in Keys) and try again.",
  },
  {
    category: "auth_failed",
    match: /(?:Encrypted private OpenSSH key detected|Cannot parse privateKey: Unsupported key format|bad decrypt)/i,
    message: "Couldn't decrypt the private key.",
    hint:
      "The passphrase you stored for this key didn't match. Re-enter it in the host editor and retry.",
  },
  // Host key mismatch.
  {
    category: "host_key_mismatch",
    match: /(?:Host key verification failed|server presented a different host key|host key.*does not match)/i,
    message: "Host key has changed.",
    hint:
      "The server's key no longer matches the one you trusted. Either the host was rebuilt, or this is a MITM. Re-scan the host in Keys → Known hosts and confirm the new fingerprint before reconnecting.",
  },
  // Network issues.
  {
    category: "network_unreachable",
    match: /(?:ENETUNREACH|EHOSTUNREACH|no route to host)/i,
    message: "Network unreachable.",
    hint:
      "Your machine couldn't reach the host's network. Check VPN, Wi-Fi, or firewall — the address resolves but the route doesn't.",
  },
  {
    category: "refused",
    match: /(?:ECONNREFUSED|Connection refused)/i,
    message: "Connection refused.",
    hint:
      "The host is reachable but nothing's listening on that port. Verify sshd is running and the port number matches the server config.",
  },
  {
    category: "timeout",
    match: /(?:ETIMEDOUT|connection timed out|Connection timed out)/i,
    message: "Connection timed out.",
    hint:
      "Reached the host but never got a response. Check the firewall and any cloud security-group rules. If this host is behind a bastion, configure it in Jump host.",
  },
  {
    category: "dns_failure",
    match: /(?:ENOTFOUND|EAI_AGAIN|getaddrinfo)/i,
    message: "Hostname did not resolve.",
    hint:
      "DNS lookup failed. Confirm the hostname is spelled correctly. If it's an internal name, you may need VPN or split DNS.",
  },
];

const KNOWN_CATEGORIES: readonly SshErrorCategory[] = [
  "auth_failed",
  "host_key_mismatch",
  "network_unreachable",
  "timeout",
  "refused",
  "dns_failure",
];

/**
 * #203: commands migrated to the typed `IpcError` reject with `{ code, message }`
 * where `code` is one of the category names above. Read that first — it is a
 * stable contract — and only fall back to the prose rules for the commands
 * still returning bare strings. Returns null when there is no usable code.
 */
export function categoryFromErrorCode(error: unknown): SshErrorCategory | null {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return null;
  }
  const code = (error as { code: unknown }).code;
  if (typeof code !== "string") {
    return null;
  }
  // The backend's catch-all is "internal"; treat it like an unclassified string
  // so the prose rules still get a chance at the message text.
  if (code === "internal") {
    return null;
  }
  return (KNOWN_CATEGORIES as readonly string[]).includes(code) ? (code as SshErrorCategory) : null;
}

function rawMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "object" && error !== null && "message" in error) {
    return String((error as { message: unknown }).message ?? "");
  }
  return String(error ?? "");
}

export function classifySshError(error: unknown): ClassifiedSshError {
  const raw = rawMessage(error);
  const coded = categoryFromErrorCode(error);
  if (coded !== null) {
    // Prefer the most specific rule of that category (one whose prose pattern
    // also matches), then fall back to the category's first rule.
    const rule =
      RULES.find((candidate) => candidate.category === coded && candidate.match.test(raw)) ??
      RULES.find((candidate) => candidate.category === coded);
    return {
      category: coded,
      message: rule?.message ?? "Connection failed.",
      hint: rule?.hint,
      raw,
    };
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    return {
      category: "unknown",
      message: "Connection failed.",
      raw,
    };
  }
  for (const rule of RULES) {
    if (rule.match.test(trimmed)) {
      return {
        category: rule.category,
        message: rule.message,
        hint: rule.hint,
        raw,
      };
    }
  }
  return {
    category: "unknown",
    message: "Connection failed.",
    hint: "We couldn't classify this error. The full message is shown below.",
    raw,
  };
}
