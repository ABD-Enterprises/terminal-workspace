import { expect, it } from "vitest";

it("imports successfully", async () => {
  const mod = await import("./demo-backend");
  expect(mod).toBeDefined();
});

it("returns path-free SSH config glob matches", async () => {
  const { globDemoSshConfigFiles } = await import("./demo-backend");
  const matches = await globDemoSshConfigFiles("~/.ssh/conf.d/*");

  expect(matches.map((match) => match.name)).toEqual(["10-staging", "20-prod"]);
  expect(matches.every((match) => Boolean(match.cycleKey))).toBe(true);
  expect(matches.every((match) => !("path" in match))).toBe(true);
});

it("defaults a blank generate-key comment to the current product name", async () => {
  const { generateDemoPrivateKey } = await import("./demo-backend");
  const key = await generateDemoPrivateKey({
    comment: "   ",
    passphrase: "",
    path: "~/.ssh/id_ed25519",
    type: "ed25519",
  });

  expect(key.comment).toBe("terminal-workspace@demo");
});
