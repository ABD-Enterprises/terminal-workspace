export type RemoteEntryKind = "directory" | "file";

export interface RemoteFileEntry {
  name: string;
  path: string;
  kind: RemoteEntryKind;
  size: number;
  modifiedAt?: string;
  permissions?: string;
}

export type TransferDirection = "upload" | "download" | "remote";
export type TransferStatus = "queued" | "running" | "completed" | "failed";

export interface TransferItem {
  id: string;
  hostId: string;
  hostLabel: string;
  direction: TransferDirection;
  name: string;
  remotePath: string;
  status: TransferStatus;
  bytes?: number;
  createdAt: string;
  updatedAt: string;
  errorMessage?: string;
}

export function createTransferItem(
  values: Pick<TransferItem, "hostId" | "hostLabel" | "direction" | "name" | "remotePath" | "bytes">
): TransferItem {
  const now = new Date().toISOString();

  return {
    id: crypto.randomUUID(),
    status: "queued",
    createdAt: now,
    updatedAt: now,
    ...values,
  };
}
