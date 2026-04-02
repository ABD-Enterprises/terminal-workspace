import type { BackendHostConnection, KnownHostScanResult, SnippetExecutionResult } from "./api";
import type { PortForwardRecord } from "../types/forward";
import type { KeyGenerationType, KeyMetadata } from "../types/key";
import type { RemoteFileEntry, RemoteEntryKind } from "../types/transfer";

interface DemoDirectoryResponse {
  entries: RemoteFileEntry[];
  path: string;
}

interface DemoNode {
  kind: RemoteEntryKind;
  name: string;
  path: string;
  size: number;
  permissions: string;
  modifiedAt: string;
  contents?: string;
}

interface GenerateKeyPayload {
  comment: string;
  passphrase: string;
  path: string;
  type: KeyGenerationType;
}

interface CreateForwardPayload {
  direction: "local" | "remote";
  localHost: string;
  localPort: number;
  remoteHost: string;
  remotePort: number;
  sessionId: string;
}

interface DemoSnippetExecutionTarget {
  host: BackendHostConnection;
  id: string;
  label: string;
}

const demoTimestamps = {
  recent: "2026-03-29T11:10:00.000Z",
  today: "2026-04-01T09:15:00.000Z",
};

function normalizePath(pathname: string) {
  const segments = pathname.split("/").filter(Boolean);
  return segments.length ? `/${segments.join("/")}` : "/";
}

function dirname(pathname: string) {
  const normalized = normalizePath(pathname);
  if (normalized === "/") {
    return "/";
  }

  const segments = normalized.split("/").filter(Boolean);
  segments.pop();
  return segments.length ? `/${segments.join("/")}` : "/";
}

function basename(pathname: string) {
  const normalized = normalizePath(pathname);
  return normalized.split("/").filter(Boolean).slice(-1)[0] ?? "";
}

function joinPath(basePath: string, childName: string) {
  const normalizedBase = normalizePath(basePath);
  const normalizedChild = childName.trim().replace(/^\/+/, "");
  if (!normalizedChild) {
    return normalizedBase;
  }

  return normalizePath(
    normalizedBase === "/" ? `/${normalizedChild}` : `${normalizedBase}/${normalizedChild}`
  );
}

function createDirectory(path: string, modifiedAt = demoTimestamps.recent): DemoNode {
  return {
    kind: "directory",
    name: basename(path) || "/",
    path: normalizePath(path),
    size: 0,
    permissions: "755",
    modifiedAt,
  };
}

function createFile(
  path: string,
  contents: string,
  modifiedAt = demoTimestamps.recent,
  permissions = "644"
): DemoNode {
  return {
    kind: "file",
    name: basename(path),
    path: normalizePath(path),
    size: contents.length,
    permissions,
    modifiedAt,
    contents,
  };
}

function cloneTree(tree: Map<string, DemoNode>) {
  return new Map(
    Array.from(tree.entries()).map(([path, node]) => [path, { ...node }])
  );
}

function hostKey(host: Pick<BackendHostConnection, "hostname" | "port">) {
  return `${host.hostname}:${host.port}`;
}

function hashText(value: string) {
  let hash = 0;
  for (const character of value) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  }
  return hash.toString(36).padStart(8, "0");
}

function fingerprint(value: string) {
  return `SHA256:${hashText(value).slice(0, 12)}`;
}

function algorithmForPath(path: string) {
  const normalized = path.toLowerCase();
  if (normalized.includes("ed25519")) {
    return { algorithm: "ED25519" as const, bits: 256 };
  }

  if (normalized.includes("ecdsa")) {
    return { algorithm: "ECDSA" as const, bits: 521 };
  }

  return { algorithm: "RSA" as const, bits: 4096 };
}

function algorithmForType(type: KeyGenerationType) {
  switch (type) {
    case "ed25519":
      return { algorithm: "ED25519" as const, bits: 256 };
    case "ecdsa":
      return { algorithm: "ECDSA" as const, bits: 521 };
    default:
      return { algorithm: "RSA" as const, bits: 4096 };
  }
}

function buildDemoTree(rootPath: string, nodes: DemoNode[]) {
  const tree = new Map<string, DemoNode>();
  const normalizedRoot = normalizePath(rootPath);

  tree.set("/", createDirectory("/", demoTimestamps.recent));

  const segments = normalizedRoot.split("/").filter(Boolean);
  let currentPath = "";
  for (const segment of segments) {
    currentPath = `${currentPath}/${segment}`;
    const normalizedPath = normalizePath(currentPath);
    tree.set(normalizedPath, createDirectory(normalizedPath, demoTimestamps.recent));
  }

  nodes.forEach((node) => {
    tree.set(node.path, { ...node, path: normalizePath(node.path) });
  });

  return tree;
}

const demoTreeSeeds = new Map<string, Map<string, DemoNode>>([
  [
    "bastion.acme.internal:22",
    buildDemoTree("/srv", [
      createDirectory("/srv/apps", demoTimestamps.today),
      createDirectory("/srv/releases", demoTimestamps.today),
      createDirectory("/srv/backups", demoTimestamps.recent),
      createFile(
        "/srv/deploy.log",
        "2026-04-01T09:00:00Z release 2026.04.01 promoted to production\n",
        demoTimestamps.today
      ),
      createFile(
        "/srv/README.md",
        "# Production Gateway\nShared ingress host for the demo workspace.\n",
        demoTimestamps.recent
      ),
      createFile(
        "/srv/releases/2026.04.01.txt",
        "release=2026.04.01\nstatus=healthy\n",
        demoTimestamps.today
      ),
    ]),
  ],
  [
    "billing-api-02.use1.internal:2222",
    buildDemoTree("/var/www", [
      createDirectory("/var/www/current", demoTimestamps.today),
      createDirectory("/var/www/shared", demoTimestamps.recent),
      createFile(
        "/var/www/package.json",
        '{\n  "name": "billing-api",\n  "version": "2026.04.01"\n}\n',
        demoTimestamps.today
      ),
      createFile(
        "/var/www/current/.env.example",
        "APP_ENV=staging\nLOG_LEVEL=debug\n",
        demoTimestamps.today
      ),
    ]),
  ],
  [
    "10.42.7.14:22",
    buildDemoTree("/cfg", [
      createDirectory("/cfg/backups", demoTimestamps.recent),
      createFile(
        "/cfg/running-config.txt",
        "hostname edge-router-07\ninterface vlan10\n  ip address 10.42.7.14/24\n",
        demoTimestamps.today
      ),
      createFile(
        "/cfg/backups/last-known-good.txt",
        "hostname edge-router-07\nfailover enabled\n",
        demoTimestamps.recent
      ),
    ]),
  ],
]);

function createDefaultTree(host: BackendHostConnection) {
  const rootPath = normalizePath(host.sftpRoot ?? "/");
  return buildDemoTree(rootPath, [
    createDirectory(joinPath(rootPath, "logs"), demoTimestamps.recent),
    createFile(
      joinPath(rootPath, "README.txt"),
      `Demo workspace for ${host.username}@${host.hostname}\n`,
      demoTimestamps.today
    ),
  ]);
}

let demoTrees = new Map(
  Array.from(demoTreeSeeds.entries()).map(([key, tree]) => [key, cloneTree(tree)])
);
let demoForwards: PortForwardRecord[] = [];

export function resetDemoBackend() {
  demoTrees = new Map(
    Array.from(demoTreeSeeds.entries()).map(([key, tree]) => [key, cloneTree(tree)])
  );
  demoForwards = [];
}

function ensureTree(host: BackendHostConnection) {
  const key = hostKey(host);
  const existingTree = demoTrees.get(key);
  if (existingTree) {
    return existingTree;
  }

  const seededTree = createDefaultTree(host);
  demoTrees.set(key, seededTree);
  return seededTree;
}

function assertDirectory(tree: Map<string, DemoNode>, path: string) {
  const node = tree.get(path);
  if (!node || node.kind !== "directory") {
    throw new Error(`Directory not found: ${path}`);
  }
}

function assertEntry(tree: Map<string, DemoNode>, path: string) {
  const node = tree.get(path);
  if (!node) {
    throw new Error(`Remote entry not found: ${path}`);
  }
  return node;
}

function listChildren(tree: Map<string, DemoNode>, path: string) {
  return Array.from(tree.values())
    .filter((node) => node.path !== path && dirname(node.path) === path)
    .sort((left, right) => {
      if (left.kind !== right.kind) {
        return left.kind === "directory" ? -1 : 1;
      }
      return left.name.localeCompare(right.name);
    })
    .map((node) => ({
      kind: node.kind,
      modifiedAt: node.modifiedAt,
      name: node.name,
      path: node.path,
      permissions: node.permissions,
      size: node.size,
    }));
}

export async function listDemoRemoteDirectory(
  host: BackendHostConnection,
  path: string
): Promise<DemoDirectoryResponse> {
  const tree = ensureTree(host);
  const resolvedPath = normalizePath(path || host.sftpRoot || "/");
  assertDirectory(tree, resolvedPath);

  return {
    entries: listChildren(tree, resolvedPath),
    path: resolvedPath,
  };
}

export async function createDemoRemoteDirectory(host: BackendHostConnection, path: string) {
  const tree = ensureTree(host);
  const targetPath = normalizePath(path);
  const parentPath = dirname(targetPath);
  assertDirectory(tree, parentPath);

  tree.set(targetPath, createDirectory(targetPath, demoTimestamps.today));

  return {
    ok: true,
    path: targetPath,
  };
}

export async function renameDemoRemoteEntry(
  host: BackendHostConnection,
  currentPath: string,
  nextPath: string
) {
  const tree = ensureTree(host);
  const sourcePath = normalizePath(currentPath);
  const targetPath = normalizePath(nextPath);
  const sourceNode = assertEntry(tree, sourcePath);
  assertDirectory(tree, dirname(targetPath));

  const affectedNodes = Array.from(tree.values()).filter(
    (node) => node.path === sourcePath || node.path.startsWith(`${sourcePath}/`)
  );

  affectedNodes.forEach((node) => {
    tree.delete(node.path);
  });

  affectedNodes.forEach((node) => {
    const renamedPath = node.path.replace(sourcePath, targetPath);
    tree.set(renamedPath, {
      ...node,
      name: basename(renamedPath),
      path: renamedPath,
      modifiedAt: demoTimestamps.today,
    });
  });

  if (sourceNode.kind === "directory" && !tree.has(targetPath)) {
    tree.set(targetPath, createDirectory(targetPath, demoTimestamps.today));
  }

  return {
    ok: true,
    path: targetPath,
  };
}

export async function deleteDemoRemoteEntry(
  host: BackendHostConnection,
  path: string,
  isDirectory: boolean
) {
  const tree = ensureTree(host);
  const targetPath = normalizePath(path);
  const node = assertEntry(tree, targetPath);

  if (isDirectory && node.kind !== "directory") {
    throw new Error(`Directory not found: ${targetPath}`);
  }

  Array.from(tree.keys())
    .filter((entryPath) => entryPath === targetPath || entryPath.startsWith(`${targetPath}/`))
    .forEach((entryPath) => {
      tree.delete(entryPath);
    });

  return { ok: true };
}

export async function uploadDemoRemoteFile(
  host: BackendHostConnection,
  remotePath: string,
  file: File
) {
  const tree = ensureTree(host);
  const targetPath = normalizePath(remotePath);
  const parentPath = dirname(targetPath);
  assertDirectory(tree, parentPath);

  tree.set(
    targetPath,
    createFile(targetPath, await file.text(), demoTimestamps.today)
  );

  return {
    ok: true,
    path: targetPath,
  };
}

export async function downloadDemoRemoteFile(host: BackendHostConnection, path: string) {
  const tree = ensureTree(host);
  const targetPath = normalizePath(path);
  const node = assertEntry(tree, targetPath);
  if (node.kind !== "file") {
    throw new Error(`File not found: ${targetPath}`);
  }

  return {
    blob: new Blob([node.contents ?? ""], { type: "text/plain" }),
    filename: node.name,
  };
}

export async function inspectDemoPrivateKey(path: string): Promise<KeyMetadata> {
  const normalizedPath = path.trim();
  if (!normalizedPath) {
    throw new Error("A private key path is required.");
  }

  const metadata = algorithmForPath(normalizedPath);
  return {
    ...metadata,
    comment: `${basename(normalizedPath)}@demo`,
    fingerprint: fingerprint(normalizedPath),
    privateKeyPath: normalizedPath,
    publicKeyPath: `${normalizedPath}.pub`,
  };
}

export async function generateDemoPrivateKey(payload: GenerateKeyPayload): Promise<KeyMetadata> {
  const normalizedPath = payload.path.trim();
  if (!normalizedPath) {
    throw new Error("A destination path is required.");
  }

  const metadata = algorithmForType(payload.type);
  return {
    ...metadata,
    comment: payload.comment.trim() || "termsnip@demo",
    fingerprint: fingerprint(`${payload.type}:${normalizedPath}:${payload.comment}`),
    privateKeyPath: normalizedPath,
    publicKeyPath: `${normalizedPath}.pub`,
  };
}

export async function scanDemoKnownHost(
  hostname: string,
  port: number
): Promise<{ entries: KnownHostScanResult[] }> {
  const algorithm = "ssh-ed25519";
  return {
    entries: [
      {
        algorithm,
        fingerprint: fingerprint(`${hostname}:${port}:${algorithm}`),
        hostname,
        port,
        publicKey: `AAAAC3NzaC1lZDI1NTE5AAAAI${hashText(`${hostname}:${port}`)}`,
      },
    ],
  };
}

export async function executeDemoSnippetOnHosts(
  command: string,
  targets: DemoSnippetExecutionTarget[]
): Promise<{ results: SnippetExecutionResult[] }> {
  return {
    results: targets.map((target) => ({
      targetId: target.id,
      label: target.label,
      ok: true,
      stdout: `Demo mode executed "${command}" on ${target.host.hostname}.`,
      stderr: "",
      exitCode: 0,
    })),
  };
}

export async function listDemoForwards(sessionId: string) {
  return {
    forwards: demoForwards.filter((forward) => forward.sessionId === sessionId),
  };
}

export async function createDemoForward(payload: CreateForwardPayload) {
  const record: PortForwardRecord = {
    id: crypto.randomUUID(),
    createdAt: demoTimestamps.today,
    ...payload,
  };

  demoForwards = [record, ...demoForwards];
  return record;
}

export async function deleteDemoForward(forwardId: string) {
  demoForwards = demoForwards.filter((forward) => forward.id !== forwardId);
  return { ok: true };
}
