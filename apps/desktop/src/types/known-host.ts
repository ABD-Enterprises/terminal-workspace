import type { KnownHostScanResult } from "../lib/api";

export interface KnownHostRecord {
  id: string;
  hostname: string;
  port: number;
  algorithm: string;
  publicKey: string;
  fingerprint: string;
  trustedAt: string;
  updatedAt: string;
}

export function createKnownHostId(entry: Pick<KnownHostRecord, "hostname" | "port" | "algorithm">) {
  return `${entry.hostname}:${entry.port}:${entry.algorithm}`;
}

export function createKnownHostRecord(entry: KnownHostScanResult): KnownHostRecord {
  const now = new Date().toISOString();

  return {
    id: createKnownHostId(entry),
    hostname: entry.hostname,
    port: entry.port,
    algorithm: entry.algorithm,
    publicKey: entry.publicKey,
    fingerprint: entry.fingerprint,
    trustedAt: now,
    updatedAt: now,
  };
}

export const sampleKnownHosts: KnownHostRecord[] = [
  {
    id: "bastion.acme.internal:22:ssh-ed25519",
    hostname: "bastion.acme.internal",
    port: 22,
    algorithm: "ssh-ed25519",
    publicKey: "AAAAC3NzaC1lZDI1NTE5AAAAIKprodgatewaydemo",
    fingerprint: "SHA256:prodGatewayDemoKey",
    trustedAt: "2026-03-27T16:40:00.000Z",
    updatedAt: "2026-03-29T11:10:00.000Z",
  },
  {
    id: "billing-api-02.use1.internal:2222:ssh-ed25519",
    hostname: "billing-api-02.use1.internal",
    port: 2222,
    algorithm: "ssh-ed25519",
    publicKey: "AAAAC3NzaC1lZDI1NTE5AAAAIKbillingapidemo",
    fingerprint: "SHA256:billingDeployDemo",
    trustedAt: "2026-03-27T15:00:00.000Z",
    updatedAt: "2026-03-28T17:45:00.000Z",
  },
];
