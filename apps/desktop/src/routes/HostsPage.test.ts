import { describe, expect, it } from "vitest";
import { parseQuickConnect } from "./HostsPage";

it("imports successfully", async () => {
  const mod = await import("./HostsPage");
  expect(mod).toBeDefined();
});

describe("parseQuickConnect", () => {
  it("parses user@host with a -p port flag", () => {
    expect(parseQuickConnect("deploy@quick.example.com -p 2200")).toEqual({
      username: "deploy",
      hostname: "quick.example.com",
      port: "2200",
    });
  });

  it("keeps a typed username and inline port", () => {
    expect(parseQuickConnect("ops@bastion.example.com:2222")).toEqual({
      username: "ops",
      hostname: "bastion.example.com",
      port: "2222",
    });
  });

  it("does not assume a username for a bare host", () => {
    // Regression: the parser used to fall back to "root", which silently
    // connected as the wrong account. A bare host now yields an empty
    // username the caller must refuse to connect with.
    expect(parseQuickConnect("bastion.example.com")).toEqual({
      username: "",
      hostname: "bastion.example.com",
      port: "22",
    });
  });

  it("keeps the username empty when only the @ is typed", () => {
    expect(parseQuickConnect("@bastion.example.com")).toEqual({
      username: "",
      hostname: "bastion.example.com",
      port: "22",
    });
  });

  it("returns null when there is no hostname", () => {
    expect(parseQuickConnect("")).toBeNull();
    expect(parseQuickConnect("   ")).toBeNull();
    // A user with no host after the @ has nothing to connect to.
    expect(parseQuickConnect("deploy@")).toBeNull();
  });
});
