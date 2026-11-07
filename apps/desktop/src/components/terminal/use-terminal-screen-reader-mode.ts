import { useEffect, type MutableRefObject } from "react";
import { type Terminal } from "xterm";
import { useAppStore } from "../../store/app-store";

/**
 * #510: apply the "Screen reader support" setting to this pane's terminal,
 * including one that is already open, without restarting its session. xterm
 * then reads the terminal's output to screen readers itself.
 *
 * Only the active pane gets it: xterm's screen reader mode announces output
 * through an assertive live region, so a background split pane would
 * otherwise interrupt whatever the user is doing in the active one.
 *
 * `modeRef` holds the same value for the lifecycle, so a terminal recreated
 * later (after a host change) starts in the right mode. Returns whether this
 * pane's terminal is speaking for itself.
 */
export function useTerminalScreenReaderMode(
  terminalRef: MutableRefObject<Pick<Terminal, "options"> | null>,
  modeRef: MutableRefObject<boolean>,
  active: boolean
): boolean {
  const enabled = useAppStore((state) => state.terminalScreenReaderMode);
  const speaks = enabled && active;
  useEffect(() => {
    modeRef.current = speaks;
    if (terminalRef.current) {
      terminalRef.current.options.screenReaderMode = speaks;
    }
  }, [modeRef, speaks, terminalRef]);
  return speaks;
}
