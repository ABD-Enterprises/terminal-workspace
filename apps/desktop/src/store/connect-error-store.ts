import { create } from "zustand";

// Connect-failure channel.
//
// `launchHostSession` already returns a good, actionable `errorMessage` for
// every failure mode (unreachable host, no host keys returned, trust
// rejected). Every call site used to take that message and drop it into
// `console.warn`, so the single most common failure in the product — a host
// that is down, firewalled, or mis-typed — produced no on-screen output at
// all. The user clicked "Open", no tab appeared, and the app looked broken.
//
// One store, one banner, one place to report from: the call sites keep
// their `console.warn` for debugging, and the message reaches the screen
// regardless of which surface started the connect (hosts page, sidebar,
// command palette, welcome panel).

export type ConnectErrorTone = "error" | "warning";

export interface ConnectErrorState {
  /** The message to show, or null when there is nothing to report. */
  message: string | null;
  /**
   * "warning" for a failure the user chose (they rejected a host key), so
   * it is reported without reading as an error.
   */
  tone: ConnectErrorTone;
  setConnectError: (message: string, tone?: ConnectErrorTone) => void;
  clearConnectError: () => void;
}

export const useConnectErrorStore = create<ConnectErrorState>((set) => ({
  message: null,
  tone: "error",
  setConnectError: (message, tone = "error") => set({ message, tone }),
  clearConnectError: () => set({ message: null, tone: "error" }),
}));

/**
 * Report a connect failure to the app shell.
 *
 * Accepts the optional `errorMessage` from `launchHostSession` directly so
 * a call site can pass it straight through without a null check. An empty
 * message is ignored — it would render a blank banner.
 */
export function reportConnectError(
  message: string | null | undefined,
  tone: ConnectErrorTone = "error"
) {
  if (!message) {
    return;
  }
  useConnectErrorStore.getState().setConnectError(message, tone);
}
