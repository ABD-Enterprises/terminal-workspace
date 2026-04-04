export type HostAuthMethod = "none" | "password" | "privateKey";
export type HostKeyPolicy = "allowUnknown" | "requireTrusted";

export const defaultHostKeyPolicy: HostKeyPolicy = "allowUnknown";

export interface HostRecord {
  id: string;
  label: string;
  hostname: string;
  username: string;
  port: number;
  authMethod: HostAuthMethod;
  privateKeyPath: string;
  group: string;
  tags: string[];
  note: string;
  favorite: boolean;
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
}

export interface HostFormValues {
  label: string;
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
}

export const emptyHostFormValues: HostFormValues = {
  label: "",
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
};

export const sampleHosts: HostRecord[] = [
  {
    id: "prod-gateway",
    label: "Production Gateway",
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
  },
  {
    id: "billing-api",
    label: "Billing API",
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
  },
  {
    id: "edge-router-07",
    label: "Edge Router 07",
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
];

export function hostToFormValues(host: HostRecord): HostFormValues {
  return {
    label: host.label,
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
  };
}
