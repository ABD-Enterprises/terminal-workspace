import { type TerminalPaneLifecycleOptions, useTerminalPaneLifecycleEffect } from "./use-terminal-pane-lifecycle-effect";

export type { TerminalPaneLifecycleOptions } from "./use-terminal-pane-lifecycle-effect";
export { resolveNativeSessionTransport } from "./terminal-pane-transport";

export function useTerminalPaneLifecycle(options: TerminalPaneLifecycleOptions) {
  useTerminalPaneLifecycleEffect(options);
}
