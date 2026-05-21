import { describe, expect, it } from "vitest";
import { classifySshError } from "./ssh-error-classifier";

describe("classifySshError", () => {
  it("classifies 'All configured authentication methods failed' as auth_failed", () => {
    const result = classifySshError(new Error("All configured authentication methods failed"));
    expect(result.category).toBe("auth_failed");
    expect(result.message).toMatch(/Authentication failed/);
    expect(result.hint).toBeTruthy();
  });

  it("classifies 'Permission denied (publickey)' as auth_failed", () => {
    const result = classifySshError(new Error("Permission denied (publickey)."));
    expect(result.category).toBe("auth_failed");
    expect(result.message).toMatch(/Server rejected/);
  });

  it("classifies bad-decrypt errors as auth_failed", () => {
    const result = classifySshError(new Error("Cannot parse privateKey: bad decrypt"));
    expect(result.category).toBe("auth_failed");
    expect(result.hint).toMatch(/passphrase/);
  });

  it("classifies host key mismatch", () => {
    const result = classifySshError(new Error("Host key verification failed for example.com"));
    expect(result.category).toBe("host_key_mismatch");
    expect(result.hint).toMatch(/MITM/);
  });

  it("classifies ENETUNREACH as network_unreachable", () => {
    const result = classifySshError(new Error("connect ENETUNREACH 10.0.0.1:22"));
    expect(result.category).toBe("network_unreachable");
  });

  it("classifies ECONNREFUSED as refused", () => {
    const result = classifySshError(new Error("connect ECONNREFUSED 192.0.2.1:22"));
    expect(result.category).toBe("refused");
    expect(result.hint).toMatch(/sshd/);
  });

  it("classifies ETIMEDOUT as timeout", () => {
    const result = classifySshError(new Error("connect ETIMEDOUT 198.51.100.5:22"));
    expect(result.category).toBe("timeout");
    expect(result.hint).toMatch(/firewall/);
  });

  it("classifies ENOTFOUND as dns_failure", () => {
    const result = classifySshError(new Error("getaddrinfo ENOTFOUND nope.example.com"));
    expect(result.category).toBe("dns_failure");
    expect(result.hint).toMatch(/DNS/);
  });

  it("returns 'unknown' for unrecognized errors but still echoes raw", () => {
    const result = classifySshError(new Error("Some weird internal failure"));
    expect(result.category).toBe("unknown");
    expect(result.raw).toBe("Some weird internal failure");
  });

  it("handles non-Error inputs (string, undefined, null) safely", () => {
    expect(classifySshError("connection refused").category).toBe("refused");
    expect(classifySshError(undefined).category).toBe("unknown");
    expect(classifySshError(null).category).toBe("unknown");
    expect(classifySshError(undefined).message).toBeTruthy();
  });
});
