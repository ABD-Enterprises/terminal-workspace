// #185: drives the REAL backend.mjs over its actual HTTP and WebSocket surface.
//
// Started by scripts/backend-transport-test.sh, which owns the sshd fixture and
// the backend child process. This file only makes requests and asserts.
//
// Everything else in the suite proves UI wiring against mocks. This is the only
// automated path where a broken SSH handshake, auth gate, or session lifecycle
// actually fails a build.

import { createRequire } from "node:module";

// `ws` is already a runtime dependency of apps/desktop, so resolving from there
// keeps this fixture dependency-free.
const require = createRequire(new URL("../../apps/desktop/package.json", import.meta.url));
const WebSocket = require("ws");

const FIXTURE_ROOT = process.env.TW_FIXTURE_ROOT;
const BACKEND = `http://127.0.0.1:${process.env.TW_BACKEND_PORT}`;
const SSH_PORT = Number(process.env.TW_SSH_PORT);
const SSH_USER = process.env.TW_SSH_USER;
const TOKEN = process.env.TW_BACKEND_TOKEN;
const ORIGIN = process.env.TW_ALLOWED_ORIGIN;
const GLOB_CANONICAL_SENTINEL = "GLOB_SUCCESS_CANONICAL_PATH_SENTINEL";

const DEADLINE_MS = 30_000;

let failures = 0;
function check(label, condition, detail = "") {
  if (condition) {
    console.log(`  ok   ${label}`);
    return;
  }
  failures += 1;
  console.error(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`);
}

/** The host record the renderer would send for this fixture. */
function fixtureHost() {
  return {
    agentForwarding: false,
    authMethod: "privateKey",
    hostname: "127.0.0.1",
    passphrase: "",
    password: "",
    port: SSH_PORT,
    privateKeyPath: `${FIXTURE_ROOT}/id_fixture`,
    protocol: "ssh",
    sftpRoot: `${FIXTURE_ROOT}/sftproot`,
    username: SSH_USER,
    // The fixture host key is generated per run, so pinning is not possible;
    // allowUnknown is the fixture's own trust decision, not the app default.
    hostKeyPolicy: "allowUnknown",
  };
}

async function api(path, { method = "GET", body, origin, token, contentType } = {}) {
  const headers = {};
  if (contentType !== undefined) {
    headers["Content-Type"] = contentType;
  } else if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  if (origin) headers.Origin = origin;
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(`${BACKEND}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(DEADLINE_MS),
  });
  const text = await response.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  return { status: response.status, json, text, headers: response.headers };
}

/**
 * Open the session websocket and resolve once `marker` appears in a data frame.
 *
 * Returns the frames seen, so a failure can show what DID arrive rather than
 * only that something did not.
 */
function driveTerminal(sessionId, input, marker) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`${BACKEND.replace("http", "ws")}/ws/sessions/${sessionId}`, {
      headers: { Origin: ORIGIN },
    });
    const frames = [];
    let output = "";
    const timer = setTimeout(() => {
      socket.terminate();
      reject(new Error(`no marker within ${DEADLINE_MS}ms; frames: ${JSON.stringify(frames)}`));
    }, DEADLINE_MS);

    socket.on("open", () => {
      // The shell needs a moment of its own; sending on `connected` rather than
      // on open is what makes this deterministic.
    });
    socket.on("message", (raw) => {
      let message;
      try {
        message = JSON.parse(raw.toString("utf8"));
      } catch {
        return;
      }
      frames.push(message.type === "data" ? { type: "data" } : message);

      if (message.type === "status" && message.state === "connected") {
        socket.send(JSON.stringify({ type: "input", data: input }));
      }
      if (message.type === "data") {
        output += message.data;
        if (output.includes(marker)) {
          clearTimeout(timer);
          socket.close();
          resolve({ frames, output });
        }
      }
    });
    socket.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

/** Assert the WS upgrade is refused, without leaving a socket behind. */
function expectUpgradeRejected(sessionId, headers) {
  return new Promise((resolve) => {
    const socket = new WebSocket(`${BACKEND.replace("http", "ws")}/ws/sessions/${sessionId}`, {
      headers,
    });
    const timer = setTimeout(() => {
      socket.terminate();
      resolve({ rejected: false });
    }, DEADLINE_MS);
    socket.on("open", () => {
      clearTimeout(timer);
      socket.close();
      resolve({ rejected: false });
    });
    socket.on("unexpected-response", (_request, response) => {
      clearTimeout(timer);
      socket.terminate();
      resolve({ rejected: true, status: response.statusCode });
    });
    socket.on("error", () => {
      clearTimeout(timer);
      resolve({ rejected: true, status: undefined });
    });
  });
}

async function main() {
  let sessionId;
  try {
    console.log("[client] auth gate");
    // Each credential is exercised ALONE. Sending both on every request would
    // let either branch regress while the other kept authorizing the test.
    const anonymous = await api("/api/backend/status");
    check("no token and no Origin is refused", anonymous.status === 403, `status ${anonymous.status}`);

    const badToken = await api("/api/backend/status", { token: "wrong-token-wrong-token-wrong" });
    check("a wrong token is refused", badToken.status === 403, `status ${badToken.status}`);

    const byOrigin = await api("/api/backend/status", { origin: ORIGIN });
    check("an allowed Origin alone is accepted", byOrigin.status === 200, `status ${byOrigin.status}`);

    const byToken = await api("/api/backend/status", { token: TOKEN });
    check("a valid token alone is accepted", byToken.status === 200, `status ${byToken.status}`);

    console.log("[client] cross-site hardening");
    // A CORS preflight must never be answered with anything a browser would
    // accept, and the response must carry no CORS header at all.
    const preflight = await api("/api/backend/sessions", {
      method: "OPTIONS",
      origin: ORIGIN,
    });
    check("a preflight is refused", preflight.status === 405, `status ${preflight.status}`);
    check("a refused preflight carries no CORS headers",
      preflight.headers.get("access-control-allow-origin") === null &&
        preflight.headers.get("access-control-allow-methods") === null &&
        preflight.headers.get("access-control-allow-headers") === null,
      `acao ${preflight.headers.get("access-control-allow-origin")}`);

    // The content types a browser can send cross-origin WITHOUT a preflight.
    // A body in one of them must never be parsed.
    for (const contentType of ["text/plain", "application/x-www-form-urlencoded"]) {
      const simple = await api("/api/backend/sessions", {
        method: "POST",
        origin: ORIGIN,
        contentType,
        body: { host: fixtureHost() },
      });
      check(`a ${contentType} body is refused`,
        simple.status === 415, `status ${simple.status}`);
    }

    // A host record that asks for an authentication method the backend does
    // not act on.
    const unsupportedAuth = await api("/api/backend/sessions", {
      method: "POST",
      origin: ORIGIN,
      body: { host: { ...fixtureHost(), authMethod: "agent" } },
    });
    check("an unsupported authMethod is refused",
      unsupportedAuth.status === 400 &&
        unsupportedAuth.json?.error === "Unsupported authentication method.",
      `status ${unsupportedAuth.status} body ${unsupportedAuth.text.slice(0, 200)}`);

    // Agent forwarding hands the local ssh-agent to the remote host. The host
    // record asking for it is caller-controlled, so the backend only honours
    // it when it was started with TERMSNIP_ALLOW_AGENT_FORWARDING=1 — which
    // this fixture does not set.
    const agentForwarding = await api("/api/backend/sessions", {
      method: "POST",
      origin: ORIGIN,
      body: { host: { ...fixtureHost(), agentForwarding: true } },
    });
    check("agent forwarding is refused unless the backend allows it",
      agentForwarding.status === 403 &&
        agentForwarding.json?.error === "Agent forwarding is disabled on this backend.",
      `status ${agentForwarding.status} body ${agentForwarding.text.slice(0, 200)}`);

    console.log("[client] SSH config glob success boundary");
    const glob = await api("/api/backend/ssh-config/glob", {
      method: "POST",
      token: TOKEN,
      body: { pattern: "~/.ssh/conf.d/*.conf" },
    });
    const globMatches = glob.json?.matches ?? [];
    check("symlinked fragments inside ~/.ssh still resolve",
      glob.status === 200 && globMatches.length === 3 &&
        globMatches.slice(0, 2).every((match) => match.content.includes("Host linked-fragment")) &&
        globMatches[2]?.content.includes("Host distinct-fragment"),
      `status ${glob.status} body ${glob.text.slice(0, 300)}`);
    check("glob matches carry names and no paths",
      globMatches.map((match) => match.name).join(",") ===
        "10-visible.conf,20-alias.conf,30-distinct.conf" &&
        globMatches.every((match) =>
          Object.keys(match).sort().join(",") === "content,cycleKey,name"));
    check("the canonical target sentinel is withheld",
      !glob.text.includes(GLOB_CANONICAL_SENTINEL));
    check("two names for one file share one opaque cycle identity",
      globMatches.length === 3 && Boolean(globMatches[0]?.cycleKey) &&
        globMatches[0]?.cycleKey === globMatches[1]?.cycleKey);
    check("different files have different opaque cycle identities",
      Boolean(globMatches[2]?.cycleKey) &&
        globMatches[0]?.cycleKey !== globMatches[2]?.cycleKey);

    const unknownParent = await api("/api/backend/ssh-config/glob", {
      method: "POST",
      token: TOKEN,
      body: {
        pattern: "~/.ssh/conf.d/*.conf",
        parentCycleKey: "garbage",
        relativePath: "*.conf",
      },
    });
    check("an unknown parent cycle key returns a typed failure",
      unknownParent.status === 400 &&
        unknownParent.json?.reason === "invalid-path" &&
        unknownParent.json?.path === "~/.ssh/conf.d/*.conf",
      `status ${unknownParent.status} body ${unknownParent.text.slice(0, 200)}`);

    console.log("[client] session lifecycle over real SSH");
    const created = await api("/api/backend/sessions", {
      method: "POST",
      origin: ORIGIN,
      body: { host: fixtureHost() },
    });
    check("session created", created.status === 200 && Boolean(created.json?.sessionId),
      `status ${created.status} body ${created.text.slice(0, 200)}`);
    sessionId = created.json?.sessionId;
    if (!sessionId) {
      throw new Error("cannot continue without a session");
    }

    const marker = `TW_FIXTURE_MARKER_${Date.now()}`;
    const terminal = await driveTerminal(sessionId, `printf '%s\\n' ${marker}\n`, marker);
    check("terminal input reached the remote and its output came back",
      terminal.output.includes(marker));

    console.log("[client] exec endpoint");
    // A different code path from the interactive shell: this is ssh2's
    // client.exec(), which the WS session never touches.
    const execMarker = `TW_EXEC_MARKER_${Date.now()}`;
    const snippet = await api("/api/backend/snippets/execute", {
      method: "POST",
      token: TOKEN,
      body: {
        command: `printf '%s' ${execMarker}`,
        targets: [{ id: "fixture", label: "fixture", host: fixtureHost() }],
      },
    });
    const result = snippet.json?.results?.[0];
    check("exec ran and returned its output",
      snippet.status === 200 && result?.ok === true && result?.stdout?.includes(execMarker),
      `status ${snippet.status} body ${snippet.text.slice(0, 300)}`);

    console.log("[client] sftp endpoint");
    const listing = await api("/api/backend/sftp/list", {
      method: "POST",
      origin: ORIGIN,
      body: { host: fixtureHost(), path: "." },
    });
    const names = (listing.json?.entries ?? []).map((entry) => entry.name);
    check("sftp listed the seeded file", names.includes("fixture-file.txt"),
      `status ${listing.status} names ${JSON.stringify(names)}`);

    console.log("[client] websocket auth");
    const rejected = await expectUpgradeRejected(sessionId, { Origin: "http://evil.invalid" });
    check("an unlisted Origin cannot upgrade the websocket", rejected.rejected === true,
      `status ${rejected.status}`);
  } finally {
    if (sessionId) {
      // Best effort: the supervisor kills the backend regardless, but leaving a
      // live ssh2 client behind would muddy the logs on failure.
      await api(`/api/backend/sessions/${sessionId}`, { method: "DELETE", origin: ORIGIN }).catch(
        () => {}
      );
    }
  }

  const still = await api("/api/backend/status", { origin: ORIGIN });
  check("backend still serving after the run", still.status === 200, `status ${still.status}`);

  if (failures > 0) {
    console.error(`[client] ${failures} check(s) failed`);
    process.exit(1);
  }
  console.log("[client] all checks passed");
}

main().catch((error) => {
  console.error("[client] threw:", error);
  process.exit(1);
});
