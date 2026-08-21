import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { extname } from "node:path";

import { resolvePathInsideRoot } from "./backend-paths.mjs";

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

/** Build the static request handler without binding a port on import. */
export function createStaticHandler({
  root,
  resolvePath = resolvePathInsideRoot,
  statPath = stat,
  createFileReadStream = createReadStream,
}) {
  function respondPlainNotFound(response) {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
  }

  async function respondStaticNotFound(response) {
    // #282: Missing and refused paths share this exact response path so neither
    // status, headers, nor body becomes an existence oracle. The separately
    // canonicalised and contained SPA shell keeps BrowserRouter bootstrapping
    // while the 404 avoids a false success. If index.html is missing, fails
    // containment, or is not a regular file, fall back to the plain 404 body.
    const indexPath = await resolvePath(root, "/index.html");
    if (indexPath === null) {
      respondPlainNotFound(response);
      return;
    }

    try {
      const indexStats = await statPath(indexPath);
      if (!indexStats.isFile()) {
        respondPlainNotFound(response);
        return;
      }
      response.writeHead(404, { "Content-Type": mimeTypes[".html"] });
      createFileReadStream(indexPath).pipe(response);
    } catch {
      respondPlainNotFound(response);
    }
  }

  async function serveStatic(request, response) {
    const requestedPath = new URL(request.url, "http://localhost").pathname;
    const normalizedPath = requestedPath === "/" ? "/index.html" : requestedPath;
    // #152(d): was `targetPath.startsWith(root)`, a string prefix rather than
    // a path one — `/app/dist-evil/x` starts with `/app/dist`.
    const targetPath = await resolvePath(root, normalizedPath);

    if (targetPath === null) {
      await respondStaticNotFound(response);
      return;
    }

    try {
      const fileStats = await statPath(targetPath);
      if (fileStats.isDirectory()) {
        await serveStatic({ ...request, url: "/index.html" }, response);
        return;
      }

      const extension = extname(targetPath);
      response.writeHead(200, {
        "Content-Type": mimeTypes[extension] ?? "application/octet-stream",
      });
      createFileReadStream(targetPath).pipe(response);
    } catch {
      await respondStaticNotFound(response);
    }
  }

  return serveStatic;
}
