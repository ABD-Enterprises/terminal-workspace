#!/usr/bin/env node
// Dev server with host/port passthrough. `npm run dev` (root) forwards any
// trailing arguments to this script, and they replace the default Vite
// host/port so an external preview harness can pick a conflict-free port:
//
//   npm run dev                          -> vite --host 127.0.0.1 --port 5173
//   npm run dev -- --host 127.0.0.1 --port 7100
//
// Replaces the previous `concurrently dev:full` invocation, which hardcoded
// the Vite flags and treated forwarded args as extra concurrently commands.
// Behavior is otherwise the same: the Node backend and Vite start together,
// and when either exits the other is torn down (`concurrently -k`).
import { spawn } from "node:child_process";

const forwarded = process.argv.slice(2);
const viteArgs =
  forwarded.length > 0
    ? forwarded
    : ["--host", "127.0.0.1", "--port", "5173"];

const children = [
  spawn(process.execPath, ["./server/backend.mjs"], { stdio: "inherit" }),
  spawn("vite", viteArgs, { stdio: "inherit" }),
];

let shuttingDown = false;
let firstFailure = 0;

function shutdown() {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  for (const child of children) {
    if (!child.killed) {
      child.kill("SIGTERM");
    }
  }
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

for (const child of children) {
  child.on("exit", (code, signal) => {
    if (!shuttingDown) {
      // Mirror `concurrently -k`: one side exiting brings the other down.
      shutdown();
      if (!firstFailure && code && signal == null) {
        firstFailure = code;
      }
    }
  });
}

process.on("exit", () => {
  if (firstFailure) {
    process.exitCode = firstFailure;
  }
});
