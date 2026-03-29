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
