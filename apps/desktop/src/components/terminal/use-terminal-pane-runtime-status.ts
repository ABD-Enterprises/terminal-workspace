import { useEffect, useRef, useState } from "react";
import { getProtocolRuntimeStatus } from "../../lib/api";
import { type HostRecord } from "../../types/host";

export interface RuntimeStatusMessage {
  available: boolean;
  installHint?: string;
  message: string;
}

export function normalizeRuntimeStatus(status: RuntimeStatusMessage): RuntimeStatusMessage {
  return {
    available: status.available,
    installHint: status.installHint,
    message: status.message,
  };
}

export function useTerminalPaneRuntimeStatus(protocol: HostRecord["protocol"]) {
  const runtimeStatusRef = useRef<RuntimeStatusMessage | null>(null);
  const [runtimeStatusMessage, setRuntimeStatusMessage] = useState<RuntimeStatusMessage | null>(null);

  useEffect(() => {
    let cancelled = false;

    void getProtocolRuntimeStatus(protocol).then((status) => {
      if (cancelled) {
        return;
      }

      const nextStatus = normalizeRuntimeStatus(status);
      runtimeStatusRef.current = nextStatus;
      setRuntimeStatusMessage(nextStatus);
    });

    return () => {
      cancelled = true;
    };
  }, [protocol]);

  return { runtimeStatusMessage, runtimeStatusRef, setRuntimeStatusMessage };
}
