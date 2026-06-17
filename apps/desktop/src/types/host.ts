export type HostAuthMethod = "none" | "password" | "privateKey";
export type HostProtocol = "ssh" | "localShell" | "telnet" | "serial" | "mosh";
export type HostKeyPolicy = "allowUnknown" | "requireTrusted";

export const defaultHostProtocol: HostProtocol = "ssh";
// Secure-by-default: new hosts require an explicitly-trusted host key before
// the first connection. Users can opt-in to "allowUnknown" per host in the
// editor for lab/local-only targets, but the app must not silently TOFU.
// See internal/parity-and-hardening-review.md §3.S-1.
export const defaultHostKeyPolicy: HostKeyPolicy = "requireTrusted";

export interface HostRecord {
  id: string;
  label: string;
  protocol: HostProtocol;
  hostname: string;
  /**
   * @deprecated P2-DM1 B4 — owned by the bound IdentityRecord; the runtime
   * reads from the identity when `identityId` is set (see connections.ts).
   * Kept on the host record as a fallback so a partially-migrated workspace
   * keeps working. Slated for removal in 0.2.0 once we have evidence the
   * auto-migration ran successfully on every upgrading install.
   */
  username: string;
  port: number;
  /**
   * @deprecated P2-DM1 B4 — owned by the bound IdentityRecord. See
   * `username` for the removal contract.
   */
  authMethod: HostAuthMethod;
  /**
   * @deprecated P2-DM1 B4 — owned by the bound IdentityRecord. See
   * `username` for the removal contract.
   */
  privateKeyPath: string;
  group: string;
  tags: string[];
  note: string;
  favorite: boolean;
  /**
   * @deprecated P2-DM1 B4 — replaced by `IdentityRecord.label`. The
   * HostEditor stops writing this field once an identity is bound; it
   * stays on the record as display metadata for unmigrated hosts.
   */
  keyLabel: string;
  hostKeyPolicy: HostKeyPolicy;
  agentForwarding: boolean;
  environment: Record<string, string>;
  jumpHostId?: string;
  sftpRoot: string;
  snippetCount: number;
  forwardingCount: number;
  createdAt: string;
  updatedAt: string;
  lastConnectedAt?: string;
  /**
   * Foreign key into `useIdentitiesStore`. When present, the identity owns
   * the canonical (username, authMethod, privateKeyPath) triple and the
   * runtime reads from the identity (see connections.ts P2-DM1 B3). The
   * per-host duplicates above are deprecated and will be removed in 0.2.0
   * (P2-DM1 B4).
   */
  identityId?: string;
}

export interface HostFormValues {
  label: string;
  protocol: HostProtocol;
  hostname: string;
  username: string;
  port: string;
  authMethod: HostAuthMethod;
  password: string;
  privateKeyPath: string;
  passphrase: string;
  group: string;
  tags: string;
  note: string;
  favorite: boolean;
  keyLabel: string;
  hostKeyPolicy: HostKeyPolicy;
  agentForwarding: boolean;
  environment: string;
  jumpHostId: string;
  sftpRoot: string;
  /**
   * Optional reference to a reusable Identity (P2-DM1 batch 2). When set,
   * the host editor pre-fills `username` / `authMethod` / `privateKeyPath`
   * from the identity, and the saved record stamps the same id. Empty
   * string means "no identity bound" — the runtime continues to read the
   * per-host fields directly until P2-DM1 batch 3 lands.
   */
  identityId: string;
}

export const emptyHostFormValues: HostFormValues = {
  label: "",
  protocol: defaultHostProtocol,
  hostname: "",
  username: "root",
  port: "22",
  authMethod: "none",
  password: "",
  privateKeyPath: "",
  passphrase: "",
  group: "",
  tags: "",
  note: "",
  favorite: false,
  keyLabel: "",
  hostKeyPolicy: defaultHostKeyPolicy,
  agentForwarding: false,
  environment: "",
  jumpHostId: "",
  sftpRoot: "/home",
  identityId: "",
};

/**
 * Stable id for the built-in local-shell host. The id is fixed so that
 * code paths needing "the local terminal" (the Sidebar quick-launch
 * button, the cold-start welcome panel) can look it up without guessing.
 * The record itself is created by `useHostsStore.ensureLocalShellHost()`
 * if it isn't already present.
 */
export const LOCAL_SHELL_HOST_ID = "local-shell";

/** Factory for the canonical local-shell HostRecord. */
export function createLocalShellHostRecord(): HostRecord {
  const now = new Date().toISOString();
  return {
    id: LOCAL_SHELL_HOST_ID,
    label: "Local Shell",
    protocol: "localShell",
    hostname: "localhost",
    username: "local",
    port: 0,
    authMethod: "none",
    privateKeyPath: "",
    group: "Workstation / Local",
    tags: ["local", "shell"],
    note: "Launches the current macOS login shell inside the native desktop app.",
    favorite: false,
    keyLabel: "",
    hostKeyPolicy: defaultHostKeyPolicy,
    agentForwarding: false,
    environment: {
      TERMSNIP_SHELL_MODE: "native",
    },
    jumpHostId: undefined,
    sftpRoot: "",
    snippetCount: 0,
    forwardingCount: 0,
    createdAt: now,
    updatedAt: now,
    lastConnectedAt: undefined,
  };
}

export const sampleHosts: HostRecord[] = [
  {
    id: "prod-gateway",
    label: "Production Gateway",
    protocol: "ssh",
    hostname: "bastion.acme.internal",
    username: "ops",
    port: 22,
    authMethod: "privateKey",
    privateKeyPath: "~/.ssh/id_ed25519",
    group: "Acme / Production",
    tags: ["prod", "bastion"],
    note: "Primary ingress host for customer-facing services.",
    favorite: true,
    keyLabel: "MacBook Pro ED25519",
    hostKeyPolicy: defaultHostKeyPolicy,
    agentForwarding: true,
    environment: {
      APP_ENV: "production",
      BASTION_ROLE: "ingress",
    },
    jumpHostId: undefined,
    sftpRoot: "/srv",
    snippetCount: 4,
    forwardingCount: 2,
    createdAt: "2026-03-20T12:00:00.000Z",
    updatedAt: "2026-03-28T22:12:00.000Z",
    lastConnectedAt: "2026-03-29T11:10:00.000Z",
    identityId: "identity-prod-bastion-ops",
  },
  {
    id: "billing-api",
    label: "Billing API",
    protocol: "ssh",
    hostname: "billing-api-02.use1.internal",
    username: "deploy",
    port: 2222,
    authMethod: "privateKey",
    privateKeyPath: "~/.ssh/deploy_key",
    group: "Acme / Services",
    tags: ["linux", "api", "staging"],
    note: "Blue/green target used for deploy rehearsals and schema checks.",
    favorite: false,
    keyLabel: "Deploy Shared Key",
    hostKeyPolicy: defaultHostKeyPolicy,
    agentForwarding: false,
    environment: {
      APP_ENV: "staging",
    },
    jumpHostId: undefined,
    sftpRoot: "/var/www",
    snippetCount: 2,
    forwardingCount: 1,
    createdAt: "2026-03-18T08:30:00.000Z",
    updatedAt: "2026-03-28T20:12:00.000Z",
    lastConnectedAt: "2026-03-28T17:45:00.000Z",
    identityId: "identity-deploy",
  },
  {
    id: "edge-router-07",
    label: "Edge Router 07",
    protocol: "ssh",
    hostname: "10.42.7.14",
    username: "admin",
    port: 22,
    authMethod: "password",
    privateKeyPath: "",
    group: "Network / Edge",
    tags: ["network", "lab", "router"],
    note: "Used for testing VLAN changes and failover validation.",
    favorite: false,
    keyLabel: "Lab Network Key",
    hostKeyPolicy: defaultHostKeyPolicy,
    agentForwarding: false,
    environment: {},
    jumpHostId: undefined,
    sftpRoot: "/cfg",
    snippetCount: 3,
    forwardingCount: 0,
    createdAt: "2026-03-12T09:40:00.000Z",
    updatedAt: "2026-03-27T18:44:00.000Z",
    lastConnectedAt: "2026-03-27T16:02:00.000Z",
  },
  {
    id: "local-shell",
    label: "Local Shell",
    protocol: "localShell",
    hostname: "localhost",
    username: "local",
    port: 0,
    authMethod: "none",
    privateKeyPath: "",
    group: "Workstation / Local",
    tags: ["local", "shell"],
    note: "Launches the current macOS login shell inside the native desktop app.",
    favorite: false,
    keyLabel: "",
    hostKeyPolicy: defaultHostKeyPolicy,
    agentForwarding: false,
    environment: {
      TERMSNIP_SHELL_MODE: "native",
    },
    jumpHostId: undefined,
    sftpRoot: "",
    snippetCount: 0,
    forwardingCount: 0,
    createdAt: "2026-04-04T21:00:00.000Z",
    updatedAt: "2026-04-04T21:00:00.000Z",
    lastConnectedAt: undefined,
  },
];

export function hostToFormValues(host: HostRecord): HostFormValues {
  return {
    label: host.label,
    protocol: host.protocol,
    hostname: host.hostname,
    username: host.username,
    port: String(host.port),
    authMethod: host.authMethod,
    privateKeyPath: host.privateKeyPath,
    password: "",
    passphrase: "",
    group: host.group,
    tags: host.tags.filter((tag) => tag.trim().toLowerCase() !== "favorite").join(", "),
    note: host.note,
    favorite: host.favorite,
    keyLabel: host.keyLabel,
    hostKeyPolicy: host.hostKeyPolicy,
    agentForwarding: host.agentForwarding,
    environment: Object.entries(host.environment)
      .map(([key, value]) => `${key}=${value}`)
      .join("\n"),
    jumpHostId: host.jumpHostId ?? "",
    sftpRoot: host.sftpRoot,
    identityId: host.identityId ?? "",
  };
}

export function formatHostProtocol(protocol: HostProtocol) {
  switch (protocol) {
    case "localShell":
      return "Local shell";
    case "mosh":
      return "Mosh";
    case "serial":
      return "Serial";
    case "telnet":
      return "Telnet";
    case "ssh":
    default:
      return "SSH";
  }
}

export function protocolDefaultPort(protocol: HostProtocol) {
  switch (protocol) {
    case "localShell":
      return 0;
    case "telnet":
      return 23;
    case "serial":
      return 115200;
    case "mosh":
    case "ssh":
    default:
      return 22;
  }
}

export function protocolRequiresUsername(protocol: HostProtocol) {
  return protocol === "ssh" || protocol === "mosh";
}

export function hostSupportsLiveTransport(protocol: HostProtocol) {
  return (
    protocol === "ssh" ||
    protocol === "localShell" ||
    protocol === "telnet" ||
    protocol === "serial" ||
    protocol === "mosh"
  );
}

export function hostSupportsSftp(protocol: HostProtocol) {
  return protocol === "ssh";
}

export function hostSupportsTrustedKeys(protocol: HostProtocol) {
  return protocol === "ssh" || protocol === "mosh";
}

export function hostSupportsJumpHosts(protocol: HostProtocol) {
  return protocol === "ssh";
}

export function hostSupportsPortForwarding(protocol: HostProtocol) {
  return protocol === "ssh";
}

export function hostSupportsRemoteSnippets(protocol: HostProtocol) {
  return protocol === "ssh";
}

export function hostSupportsCredentialPrompt(protocol: HostProtocol) {
  return protocol === "ssh" || protocol === "mosh";
}
