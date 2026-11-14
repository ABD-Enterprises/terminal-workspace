import { create } from "zustand";
import { createJSONStorage, persist, type StateStorage } from "zustand/middleware";
import { createMigratingLocalStorage } from "../lib/persistence";
import { createTransferItem, type TransferDirection, type TransferItem } from "../types/transfer";

const fallbackStorage: StateStorage = {
  getItem: () => null,
  setItem: () => undefined,
  removeItem: () => undefined,
};

// UX-3: "active" means the transfer has not reached a terminal state.
// Closing a session (or the app) mid-transfer leaves a partial file, so the
// close guards in close-guard-store treat queued + running as blocking.
export function isActiveTransfer(item: TransferItem): boolean {
  return item.status === "queued" || item.status === "running";
}

export function countActiveTransfers(queue: TransferItem[], hostId?: string): number {
  return queue.filter(
    (item) => isActiveTransfer(item) && (hostId === undefined || item.hostId === hostId)
  ).length;
}

export function hasActiveTransfers(queue: TransferItem[], hostId?: string): boolean {
  return countActiveTransfers(queue, hostId) > 0;
}

export const INTERRUPTED_TRANSFER_MESSAGE =
  "Interrupted: the app closed before this transfer finished.";

// Transfers are never resumed after a restart, so an entry persisted as
// queued/running can only be a leftover from a session that ended mid-transfer.
// Left alone it would read as live forever: the close guards would warn about
// it on every later close and clearCompleted could not remove it. Mark such
// entries failed on hydration so they are terminal (and visible as interrupted).
export function normalizeHydratedQueue(queue: unknown): TransferItem[] {
  if (!Array.isArray(queue)) {
    return [];
  }
  return (queue as TransferItem[]).map((item) =>
    isActiveTransfer(item)
      ? { ...item, status: "failed", errorMessage: item.errorMessage ?? INTERRUPTED_TRANSFER_MESSAGE }
      : item
  );
}

function touchTransferItem(item: TransferItem, update: Partial<TransferItem>): TransferItem {
  return {
    ...item,
    ...update,
    updatedAt: new Date().toISOString(),
  };
}

interface QueueTransferInput {
  hostId: string;
  hostLabel: string;
  direction: TransferDirection;
  name: string;
  remotePath: string;
  bytes?: number;
}

interface TransfersState {
  activeHostId?: string;
  remotePathByHost: Record<string, string>;
  queue: TransferItem[];
  setActiveHost: (hostId?: string) => void;
  rememberRemotePath: (hostId: string, path: string) => void;
  queueTransfer: (values: QueueTransferInput) => string;
  markTransferRunning: (transferId: string) => void;
  completeTransfer: (transferId: string, update?: Partial<TransferItem>) => void;
  failTransfer: (transferId: string, errorMessage: string) => void;
  clearCompleted: () => void;
}

export const useTransfersStore = create<TransfersState>()(
  persist(
    (set) => ({
      activeHostId: undefined,
      remotePathByHost: {},
      queue: [],
      setActiveHost: (hostId) => set({ activeHostId: hostId }),
      rememberRemotePath: (hostId, path) =>
        set((state) => ({
          remotePathByHost: {
            ...state.remotePathByHost,
            [hostId]: path,
          },
        })),
      queueTransfer: (values) => {
        const transfer = createTransferItem(values);
        set((state) => ({
          queue: [transfer, ...state.queue].slice(0, 24),
        }));
        return transfer.id;
      },
      markTransferRunning: (transferId) =>
        set((state) => ({
          queue: state.queue.map((item) =>
            item.id === transferId ? touchTransferItem(item, { status: "running" }) : item
          ),
        })),
      completeTransfer: (transferId, update) =>
        set((state) => ({
          queue: state.queue.map((item) =>
            item.id === transferId
              ? touchTransferItem(item, { status: "completed", errorMessage: undefined, ...update })
              : item
          ),
        })),
      failTransfer: (transferId, errorMessage) =>
        set((state) => ({
          queue: state.queue.map((item) =>
            item.id === transferId
              ? touchTransferItem(item, { status: "failed", errorMessage })
              : item
          ),
        })),
      clearCompleted: () =>
        set((state) => ({
          queue: state.queue.filter((item) => item.status !== "completed"),
        })),
    }),
    {
      name: "terminal-workspace-transfers",
      merge: (persisted, current) => {
        const saved = (persisted ?? {}) as Partial<TransfersState>;
        return {
          ...current,
          ...saved,
          queue: normalizeHydratedQueue(saved.queue),
        };
      },
      storage: createJSONStorage(() =>
        typeof window === "undefined" ? fallbackStorage : createMigratingLocalStorage()
      ),
    }
  )
);
