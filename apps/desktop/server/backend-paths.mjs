// Path-containment helpers for the Node backend, kept out of backend.mjs so
// they can be unit-tested without the module binding a port on import — the
// same reason backend-buffers.mjs, backend-responses.mjs and
// backend-lifecycle.mjs live outside it.
import { isAbsolute, join, normalize, relative, sep } from "node:path";

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
 * Honest scope note: no directly exploitable request was found today, because
 * `new URL(...).pathname` collapses ordinary `..` segments before this join
 * ever runs. This is defence in depth against that normalization changing or
 * another caller arriving without it — not a patch for a live exploit.
 */
export function resolvePathInsideRoot(root, requestedPath) {
  const targetPath = normalize(join(root, requestedPath));
  const pathFromRoot = relative(root, targetPath);

  if (pathFromRoot === ".." || pathFromRoot.startsWith(`..${sep}`) || isAbsolute(pathFromRoot)) {
    return null;
  }

  return targetPath;
}
