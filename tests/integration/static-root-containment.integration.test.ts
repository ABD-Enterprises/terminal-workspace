import { createReadStream } from "node:fs";
import { once } from "node:events";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { createServer, get, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { resolvePathInsideRoot } from "../../apps/desktop/server/backend-paths.mjs";
import { createStaticHandler } from "../../apps/desktop/server/backend-static.mjs";

// #152(d): the static handler tested containment with
// `targetPath.startsWith(distRoot)`. That is a STRING prefix, not a path one, so
// a sibling directory whose name merely begins with the same characters passed:
// with a root of `/app/dist`, `/app/dist-evil/secret.txt` starts with
// `/app/dist` and was served.
//
// The first test below is the demonstration — it runs the OLD predicate and
// shows it accepting the sibling — so the bug is recorded as a fact rather than
// only described in a comment.

let fixtureRoot: string;
let ROOT: string;
let escapedLink: string;
let inRootLink: string;
let inRootTarget: string;
let chainedLink: string;
let nestedEscapedLink: string;
let symlinkedParent: string;
let symlinkedRoot: string;
let server: Server;
let port: number;
const openedPaths: string[] = [];

beforeAll(async () => {
  fixtureRoot = await mkdtemp(join(tmpdir(), "termsnip-static-root-"));
  const lexicalRoot = join(fixtureRoot, "dist");
  const outsideRoot = join(fixtureRoot, "outside");

  await mkdir(join(lexicalRoot, "assets"), { recursive: true });
  await mkdir(join(lexicalRoot, "dist-evil"), { recursive: true });
  await mkdir(outsideRoot);
  await writeFile(join(lexicalRoot, "index.html"), "INDEX");
  await writeFile(join(lexicalRoot, "assets", "app.js"), "APP");
  await writeFile(join(lexicalRoot, "dist-evil", "app.js"), "NESTED");

  const outsideSecret = join(outsideRoot, "secret.txt");
  await writeFile(outsideSecret, "SECRET");
  escapedLink = join(lexicalRoot, "escaped-secret.txt");
  await symlink(outsideSecret, escapedLink);

  inRootTarget = join(lexicalRoot, "assets", "app.js");
  inRootLink = join(lexicalRoot, "linked-app.js");
  await symlink(inRootTarget, inRootLink);
  chainedLink = join(lexicalRoot, "chained-app.js");
  await symlink(inRootLink, chainedLink);

  await mkdir(join(lexicalRoot, "nested"));
  nestedEscapedLink = join(lexicalRoot, "nested", "escaped-secret.txt");
  await symlink(outsideSecret, nestedEscapedLink);
  const outsideParent = join(outsideRoot, "parent");
  await mkdir(outsideParent);
  await writeFile(join(outsideParent, "parent-secret.txt"), "PARENT SECRET");
  symlinkedParent = join(lexicalRoot, "linked-parent");
  await symlink(outsideParent, symlinkedParent);
  symlinkedRoot = join(fixtureRoot, "dist-link");
  await symlink(lexicalRoot, symlinkedRoot);

  // macOS may spell tmpdir() through /var while realpath returns /private/var.
  // Canonicalise the fixture root so exact path assertions stay portable.
  ROOT = await realpath(lexicalRoot);
  escapedLink = join(ROOT, "escaped-secret.txt");
  inRootLink = join(ROOT, "linked-app.js");
  inRootTarget = join(ROOT, "assets", "app.js");
  chainedLink = join(ROOT, "chained-app.js");
  nestedEscapedLink = join(ROOT, "nested", "escaped-secret.txt");
  symlinkedParent = join(ROOT, "linked-parent");

  server = createServer(
    createStaticHandler({
      root: ROOT,
      createFileReadStream(path: string) {
        openedPaths.push(path);
        return createReadStream(path);
      },
    })
  );
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("test server did not bind");
  port = address.port;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  await rm(fixtureRoot, { recursive: true, force: true });
});

function requestStatic(path: string) {
  return new Promise<{
    statusCode: number | undefined;
    headers: { "content-type": string | string[] | undefined };
    body: Buffer;
  }>((resolve, reject) => {
    const request = get({ host: "127.0.0.1", port, path, agent: false }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      response.on("error", reject);
      response.on("end", () =>
        resolve({
          statusCode: response.statusCode,
          headers: { "content-type": response.headers["content-type"] },
          body: Buffer.concat(chunks),
        })
      );
    });
    request.on("error", reject);
  });
}

/** The predicate exactly as it was, kept so the flaw stays demonstrable. */
function oldPrefixPredicate(root: string, targetPath: string) {
  return targetPath.startsWith(root);
}

describe("#152(d): static root containment", () => {
  it("the old string-prefix check accepted a sibling directory", async () => {
    const lexicalRoot = join(sep, "app", "dist");
    const sibling = join(sep, "app", "dist-evil", "secret.txt");

    expect(oldPrefixPredicate(lexicalRoot, sibling)).toBe(true);
    // And the replacement refuses it.
    expect(await resolvePathInsideRoot(ROOT, join("..", "dist-evil", "secret.txt"))).toBeNull();
  });

  it("serves ordinary files under the root", async () => {
    expect(await resolvePathInsideRoot(ROOT, "/index.html")).toBe(join(ROOT, "index.html"));
    expect(await resolvePathInsideRoot(ROOT, "/assets/app.js")).toBe(join(ROOT, "assets", "app.js"));
  });

  it("allows the root itself", async () => {
    // join(root, "/") normalizes with a trailing separator. Harmless for stat,
    // and unreachable in production anyway: serveStatic rewrites "/" to
    // "/index.html" before calling this. Asserted as-is rather than papered
    // over, so the behaviour is recorded rather than assumed.
    expect(await resolvePathInsideRoot(ROOT, "/")).toBe(`${ROOT}${sep}`);
    expect(await resolvePathInsideRoot(ROOT, "/index.html")).toBe(join(ROOT, "index.html"));
  });

  it("refuses traversal out of the root", async () => {
    expect(await resolvePathInsideRoot(ROOT, "/../etc/passwd")).toBeNull();
    expect(await resolvePathInsideRoot(ROOT, "/../..")).toBeNull();
    expect(await resolvePathInsideRoot(ROOT, "/assets/../../dist-evil/x")).toBeNull();
  });

  it("refuses a sibling whose name merely extends the root's", async () => {
    // The whole point: `dist-evil` is not inside `dist`, however much the
    // strings overlap.
    expect(await resolvePathInsideRoot(ROOT, "/../dist-evil")).toBeNull();
    expect(await resolvePathInsideRoot(ROOT, "/../distraction/app.js")).toBeNull();
  });

  it("keeps a nested path that merely looks like a sibling", async () => {
    // `dist/dist-evil` IS inside the root and must still be served — the fix
    // must not over-reject on the same name appearing deeper.
    expect(await resolvePathInsideRoot(ROOT, "/dist-evil/app.js")).toBe(
      join(ROOT, "dist-evil", "app.js")
    );
  });

  it("refuses a real in-root symlink whose target is outside the root", async () => {
    // Anti-vacuity: prove the fixture is a working link to the seeded secret.
    expect((await lstat(escapedLink)).isSymbolicLink()).toBe(true);
    expect(await readFile(escapedLink, "utf8")).toBe("SECRET");

    expect(await resolvePathInsideRoot(ROOT, "/escaped-secret.txt")).toBeNull();
  });

  it("treats a missing path exactly like a refused path", async () => {
    expect(await resolvePathInsideRoot(ROOT, "/missing.txt")).toBeNull();
    expect(await resolvePathInsideRoot(ROOT, "/escaped-secret.txt")).toBeNull();
  });

  it("allows an in-root symlink and returns its canonical target", async () => {
    expect((await lstat(inRootLink)).isSymbolicLink()).toBe(true);
    expect(await resolvePathInsideRoot(ROOT, "/linked-app.js")).toBe(inRootTarget);
  });

  it("handles nested links, link chains, symlinked parents, and a symlinked root", async () => {
    expect(await resolvePathInsideRoot(ROOT, "/nested/escaped-secret.txt")).toBeNull();
    expect(await resolvePathInsideRoot(ROOT, "/chained-app.js")).toBe(inRootTarget);
    expect(await resolvePathInsideRoot(ROOT, "/linked-parent/parent-secret.txt")).toBeNull();
    expect(await resolvePathInsideRoot(symlinkedRoot, "/index.html")).toBe(join(ROOT, "index.html"));
  });

  it("preserves the static HTTP contract for contained, refused, and missing paths", async () => {
    expect((await lstat(nestedEscapedLink)).isSymbolicLink()).toBe(true);
    expect((await lstat(chainedLink)).isSymbolicLink()).toBe(true);
    expect((await lstat(symlinkedParent)).isSymbolicLink()).toBe(true);

    expect(await requestStatic("/assets/app.js")).toEqual({
      statusCode: 200,
      headers: { "content-type": "text/javascript; charset=utf-8" },
      body: Buffer.from("APP"),
    });
    expect((await requestStatic("/linked-app.js")).body).toEqual(Buffer.from("APP"));
    expect(openedPaths).toContain(inRootTarget);
    expect(openedPaths).not.toContain(inRootLink);

    const refused = await requestStatic("/escaped-secret.txt");
    const missing = await requestStatic("/deep/missing-route");
    expect(refused).toEqual(missing);
    expect(missing).toEqual({
      statusCode: 404,
      headers: { "content-type": "text/html; charset=utf-8" },
      body: Buffer.from("INDEX"),
    });
  });
});
