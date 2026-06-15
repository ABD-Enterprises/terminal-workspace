import { create } from "zustand";
import { createJSONStorage, persist, type StateStorage } from "zustand/middleware";
import { createMigratingLocalStorage } from "../lib/persistence";
import { createTransferItem, type TransferDirection, type TransferItem } from "../types/transfer";

const fallbackStorage: StateStorage = {
  getItem: () => null,
  setItem: () => undefined,
  removeItem: () => undefined,
};

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
      storage: createJSONStorage(() =>
        typeof window === "undefined" ? fallbackStorage : createMigratingLocalStorage()
      ),
    }
  )
);
