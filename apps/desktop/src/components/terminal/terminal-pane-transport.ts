import { type HostRecord } from "../../types/host";
import { type SessionTransport } from "../../types/session";

export function resolveNativeSessionTransport(
  protocol: HostRecord["protocol"]
): Exclude<SessionTransport, "mock" | "unsupported"> {
  return protocol === "localShell"
    ? "localShell"
    : protocol === "telnet"
      ? "telnet"
      : protocol === "serial"
        ? "serial"
        : protocol === "mosh"
          ? "mosh"
          : "ssh";
}
