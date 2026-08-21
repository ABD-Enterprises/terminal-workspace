// Path-containment helpers for the Node backend, kept out of backend.mjs so
// they can be unit-tested without the module binding a port on import — the
// same reason backend-buffers.mjs, backend-responses.mjs and
// backend-lifecycle.mjs live outside it.
import { realpath } from "node:fs/promises";
import { isAbsolute, join, normalize, relative, sep } from "node:path";

function escapesRoot(root, targetPath) {
  const pathFromRoot = relative(root, targetPath);
  return pathFromRoot === ".." || pathFromRoot.startsWith(`..${sep}`) || isAbsolute(pathFromRoot);
}

/**
 * #152(d): resolve `requestedPath` under `root`, or null if it escapes.
 *
 * The static handler used to test containment with
 * `targetPath.startsWith(distRoot)`. That is a STRING prefix, not a path one,
 * so a sibling directory whose name merely begins with the same characters
 * passes it: with a root of `/app/dist`, the path `/app/dist-evil/secret.txt`
 * starts with `/app/dist` and was served.
 *
 * Comparing through `relative()` is component-aware, so `dist-evil` is not
 * inside `dist` no matter how the names overlap. It also handles the root
 * itself (relative is "") and rejects an absolute result, which is what
 * `relative()` returns when the two paths share no base at all.
 *
 * #282: the component-aware check is still only lexical. A symlink under the
 * root can point outside it without putting `..` in the request, so both paths
 * must also be canonicalised and compared before the target is returned.
 */
export async function resolvePathInsideRoot(root, requestedPath) {
  const targetPath = normalize(join(root, requestedPath));
  const pathFromRoot = relative(root, targetPath);

  if (escapesRoot(root, targetPath)) {
    return null;
  }

  try {
    // Do not cache either realpath: the build output may be replaced while the
    // dev backend is running. Returning the canonical target also means the
    // caller's stat/read operations do not follow the original link again.
    const canonicalRoot = await realpath(root);
    const canonicalTarget = await realpath(targetPath);

    if (escapesRoot(canonicalRoot, canonicalTarget)) {
      return null;
    }

    // Preserve the resolver's established root spelling while still returning
    // a fully canonical path. No production request reaches this case because
    // serveStatic rewrites "/" to "/index.html" first.
    return pathFromRoot === "" && targetPath.endsWith(sep)
      ? `${canonicalTarget}${sep}`
      : canonicalTarget;
  } catch {
    // A missing target is intentionally indistinguishable from a refused one.
    return null;
  }
}

/**
 * Canonicalise a REMOTE (POSIX) path. Distinct from `resolvePathInsideRoot`
 * above, which is local static-file containment.
 *
 * #155: this used to wrap `posixPath.normalize`, and that quietly disagreed
 * with Rust's `normalize_remote_path` on four shapes a user can type into the
 * SFTP bar: `/a/b/` kept its trailing slash, `/a//` and `/a/b/../` kept one,
 * and `.` became `/.`. Rust's segment-stack is the canonical form — it never
 * leaves a trailing separator and never leaves a `.` or `..` segment behind —
 * so the algorithm is reproduced here rather than approximated by a library
 * call with different edge semantics.
 */
export function normalizeRemotePath(pathname) {
  const segments = [];

  for (const segment of String(pathname ?? "").split("/")) {
    if (segment === "" || segment === ".") {
      continue;
    }
    if (segment === "..") {
      // Pops at the root are a no-op, so traversal clamps rather than escaping.
      segments.pop();
      continue;
    }
    segments.push(segment);
  }

  return segments.length ? `/${segments.join("/")}` : "/";
}

/**
 * Resolve `pathname` against `rootPath`.
 *
 * An absolute `pathname` overrides the root: `sftpRoot` is the directory the
 * browser opens at, not a jail, and the UI's "up" navigation is unrestricted.
 * Turning it into a containment boundary would be a separate product decision.
 *
 * #155: the empty check TRIMS. It previously tested only falsiness, so a
 * whitespace-only entry produced `/srv/   ` in JS while Rust produced `/srv`.
 */
export function resolveRemotePath(rootPath = "/", pathname) {
  if (!pathname || !String(pathname).trim()) {
    return normalizeRemotePath(rootPath);
  }

  const value = String(pathname);
  if (value.startsWith("/")) {
    return normalizeRemotePath(value);
  }

  const base = String(rootPath ?? "").replace(/\/+$/, "");
  return normalizeRemotePath(base === "" ? `/${value}` : `${base}/${value}`);
}

/**
 * Reduce a value to a safe download filename.
 *
 * #155: the `u` flag is load-bearing. Without it the regex matches UTF-16 code
 * units, so an astral character such as an emoji became TWO underscores in JS
 * and one in Rust, which iterates Unicode scalars. Dots stay allowed, so
 * traversal-looking text survives as a literal name — this produces a filename,
 * not a path.
 */
export function sanitizeFilename(value) {
  return String(value ?? "").replace(/[^a-zA-Z0-9._-]/gu, "_") || "download";
}
