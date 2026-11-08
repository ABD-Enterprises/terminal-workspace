// #473: which SSH sign-in the backend may use for a host, and whether it may
// forward the user's SSH agent. Every SSH connection the backend opens
// (sessions, file transfer, remote commands, each jump hop) is built from
// these options.

import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Records how the current HTTP request passed the auth gate ("token" or
 * "origin"), so connection code deep inside a route can tell without every
 * route passing it along.
 */
export const requestAuthContext = new AsyncLocalStorage();

/**
 * The sign-in methods this backend uses, as an allowlist. "none" is not here:
 * a host set to no SSH sign-in is never connected over SSH.
 */
export const CONNECTABLE_AUTH_METHODS = new Set(["password", "privateKey"]);

export class SshAuthRefusedError extends Error {
  constructor(message, statusCode) {
    super(message);
    this.name = "SshAuthRefusedError";
    this.statusCode = statusCode;
  }
}

/**
 * ssh2 options for signing in to `host`.
 *
 * - The host's sign-in method must be on the allowlist; anything else is
 *   refused (400) before a connection is opened.
 * - ssh2 is told to try only that method. Its default order falls back to
 *   the SSH agent whenever an agent is configured, so a host set to password
 *   could otherwise sign in with the user's agent keys without saying so.
 * - Agent forwarding needs a request that presented the backend token. An
 *   allowed Origin header is not enough: any local program can send one, and
 *   forwarding hands the remote host the use of the user's keys. The browser
 *   preview, which signs requests by Origin only, therefore cannot forward
 *   the agent.
 *
 * @param {object} host
 * @param {{ authorizedBy?: string, agentSocket?: string }} context
 */
export function sshAuthOptions(host, { authorizedBy, agentSocket } = {}) {
  if (!CONNECTABLE_AUTH_METHODS.has(host?.authMethod)) {
    throw new SshAuthRefusedError(
      `Host ${host?.hostname ?? ""} does not use a supported SSH sign-in method.`,
      400
    );
  }

  const options = {
    authHandler: [host.authMethod === "password" ? "password" : "publickey"],
  };

  if (host.agentForwarding) {
    if (authorizedBy !== "token") {
      throw new SshAuthRefusedError(
        `Agent forwarding for ${host.hostname ?? "this host"} needs a request signed with the backend token.`,
        403
      );
    }
    if (agentSocket) {
      options.agent = agentSocket;
      options.agentForward = true;
    }
  }

  return options;
}
