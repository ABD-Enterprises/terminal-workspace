import { useEffect, type MutableRefObject } from "react";
import { type Terminal } from "xterm";
import { useAppStore } from "../../store/app-store";

/**
 * #510: apply the "Screen reader support" setting to this pane's terminal,
 * including one that is already open, without restarting its session. xterm
 * then keeps an accessible copy of the output for screen readers.
 */
export function useTerminalScreenReaderMode(terminalRef: MutableRefObject<Pick<Terminal, "options"> | null>) {
  const enabled = useAppStore((state) => state.terminalScreenReaderMode);
  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.options.screenReaderMode = enabled;
    }
  }, [enabled, terminalRef]);
}
