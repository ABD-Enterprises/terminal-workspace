export interface PortForwardRecord {
  id: string;
  direction: "local" | "remote";
  sessionId: string;
  localHost: string;
  localPort: number;
  remoteHost: string;
  remotePort: number;
  createdAt: string;
}
