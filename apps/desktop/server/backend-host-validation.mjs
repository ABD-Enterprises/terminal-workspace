// Host-request validation for the Node backend, factored out of backend.mjs so
// it can be unit-tested without the module binding a port on import — the same
// reason backend-buffers.mjs, backend-responses.mjs and backend-lifecycle.mjs
// live outside it.

/**
 * The authentication methods the backend accepts.
 *
 * Allowlist rather than reject-three. The host record arrives in the request
 * body, so an unrecognised `authMethod` used to travel into the SSH
 * configuration unexamined: the old check rejected `password` without a
 * password, `privateKey` without a path and `none`, and accepted everything
 * else. `HostAuthMethod` in `apps/desktop/src/types/host.ts` has exactly these
 * three values.
 */
export const ALLOWED_AUTH_METHODS = Object.freeze(["none", "password", "privateKey"]);

/**
 * A request the backend refuses to act on.
 *
 * Carries the status `respondError` should send, and a message that is
 * always a static string chosen here — never the rejected value and never
 * anything else the caller supplied. That is what makes it safe for
 * `respondError` to relay: #230 forbids relaying an error's message because
 * application code throws messages carrying absolute paths, and this class
 * cannot.
 */
export class InvalidHostError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = "InvalidHostError";
    this.statusCode = statusCode;
  }
}

/**
 * Whether a host's authentication method is one the backend acts on.
 *
 * A missing value keeps its old meaning: it was accepted before and behaved
 * like "no credentials", so it stays accepted rather than turning an
 * older saved host record into a failure.
 */
export function isSupportedAuthMethod(authMethod) {
  return ALLOWED_AUTH_METHODS.includes(authMethod ?? "none");
}

/**
 * Whether this backend may hand the user's ssh-agent to a remote host.
 *
 * Agent forwarding exposes the user's agent to the host it connects to, and
 * the request body is caller-controlled: in browser mode the backend has no
 * way to tell the app from another page on an allowlisted origin, because the
 * browser client carries no per-launch token. So the authorisation has to come
 * from the operator who started the backend, not from the request.
 *
 * Off unless `TERMSNIP_ALLOW_AGENT_FORWARDING=1` is set in the backend's
 * environment. The native (shipping) transport is a separate surface with a
 * different threat model and is not affected.
 */
export function agentForwardingAllowed(env = process.env) {
  return env?.TERMSNIP_ALLOW_AGENT_FORWARDING === "1";
}

/**
 * Check the parts of a host record the backend must not take on trust.
 *
 * Throws `InvalidHostError`; the message is static, so it is safe to relay.
 */
export function assertHostRequestIsAllowed(host, env = process.env) {
  if (!isSupportedAuthMethod(host?.authMethod)) {
    throw new InvalidHostError("Unsupported authentication method.");
  }

  if (host?.agentForwarding && !agentForwardingAllowed(env)) {
    // Refused loudly: silently connecting without the agent the host asked
    // for would be a different, quieter failure than the one requested.
    throw new InvalidHostError(
      "Agent forwarding is disabled on this backend.",
      403
    );
  }
}
