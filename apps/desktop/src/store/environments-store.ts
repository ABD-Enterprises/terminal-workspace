import { create } from "zustand";
import { createJSONStorage, persist, type StateStorage } from "zustand/middleware";
import { type EnvironmentRecord, sampleEnvironments } from "../types/environment";

const fallbackStorage: StateStorage = {
  getItem: () => null,
  setItem: () => undefined,
  removeItem: () => undefined,
};

interface EnvironmentsState {
  environments: EnvironmentRecord[];
  createEnvironment: (name: string, type: EnvironmentRecord["type"]) => string;
  updateEnvironment: (id: string, name: string, type: EnvironmentRecord["type"]) => void;
  deleteEnvironment: (id: string) => void;
}

export const useEnvironmentsStore = create<EnvironmentsState>()(
  persist(
    (set) => ({
      environments: [...sampleEnvironments],
      createEnvironment: (name, type) => {
        const id = crypto.randomUUID();
        set((state) => ({
          environments: [
            ...state.environments,
            { id, name, type, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
          ].sort((a, b) => a.name.localeCompare(b.name))
        }));
        return id;
      },
      updateEnvironment: (id, name, type) => {
        set((state) => ({
          environments: state.environments.map(e => e.id === id ? { ...e, name, type, updatedAt: new Date().toISOString() } : e)
            .sort((a, b) => a.name.localeCompare(b.name))
        }));
      },
      deleteEnvironment: (id) => {
        set((state) => ({
          environments: state.environments.filter(e => e.id !== id)
        }));
      }
    }),
    {
      name: "termsnip-environments",
      version: 1,
      storage: createJSONStorage(() =>
        typeof window === "undefined" ? fallbackStorage : window.localStorage
      ),
    }
  )
);
