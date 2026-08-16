import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// #259: Tailwind v4 moved configuration into CSS. The failure mode this guards
// is a partial revert — the v3 @tailwind directives or a reinstated JS config
// would still BUILD, producing a stylesheet missing every #110 design token,
// and nothing else in the suite would notice. These assertions are on source
// rather than build output because validate.sh runs the unit tests before the
// desktop build, so dist/ is not guaranteed to exist when this runs.

const read = (rel: string) =>
  readFileSync(fileURLToPath(new URL(`../../${rel}`, import.meta.url)), "utf8");

const GLOBALS = "apps/desktop/src/styles/globals.css";
const POSTCSS = "apps/desktop/postcss.config.js";

describe("Tailwind v4 configuration", () => {
  it("imports tailwind rather than using the removed v3 directives", () => {
    const css = read(GLOBALS);
    expect(css).toContain('@import "tailwindcss"');
    // v4 does not understand these; leaving one behind yields a stylesheet with
    // no utilities at all rather than a build error.
    expect(css).not.toMatch(/^@tailwind\s+(base|components|utilities)\s*;/m);
  });

  it("wires the dedicated v4 PostCSS plugin and drops autoprefixer", async () => {
    const config = read(POSTCSS);
    expect(config).toContain("@tailwindcss/postcss");

    // Asserted against the actual plugin keys, not the file text: the comment in
    // that file explains why autoprefixer was removed, so a naive `not.toContain`
    // matches its own rationale and fails. (It did, on the first run of this test.)
    const loaded = (await import(
      fileURLToPath(new URL(`../../${POSTCSS}`, import.meta.url))
    )) as { default: { plugins: Record<string, unknown> } };
    const plugins = Object.keys(loaded.default.plugins);

    expect(plugins).toContain("@tailwindcss/postcss");
    // v4 prefixes and inlines imports itself; re-adding autoprefixer would be a
    // redundant pass over already-prefixed output.
    expect(plugins).not.toContain("autoprefixer");
    expect(plugins, "the v3 bare `tailwindcss` plugin no longer works in v4").not.toContain(
      "tailwindcss",
    );
  });

  it("has no stale JavaScript config, which v4 would not auto-load anyway", () => {
    const stale = ["apps/desktop/tailwind.config.ts", "apps/desktop/tailwind.config.js"];
    for (const rel of stale) {
      const path = fileURLToPath(new URL(`../../${rel}`, import.meta.url));
      expect(existsSync(path), `${rel} exists but v4 ignores it without @config`).toBe(false);
    }
  });

  it("defines every #110 design token in the CSS theme", () => {
    const css = read(GLOBALS);
    const theme = css.slice(css.indexOf("@theme"));
    expect(theme, "no @theme block found").toContain("@theme");

    // Names follow v4's namespaces so the generated utility names are unchanged
    // (--text-* -> text-*, --radius-* -> rounded-*, --tracking-* -> tracking-*).
    const required = [
      "--color-neutral-925",
      "--text-caption",
      "--text-footnote",
      "--text-body",
      "--text-callout",
      "--text-title",
      "--radius-control",
      "--radius-surface",
      "--radius-panel",
      "--tracking-label",
      "--tracking-brand",
    ];
    for (const token of required) {
      expect(theme, `${token} missing from @theme`).toContain(`${token}:`);
    }
  });

  it("keeps a line-height paired with each font size", () => {
    // v3 declared these as [size, { lineHeight }] tuples. Dropping the pairing
    // would silently fall back to Tailwind's default leading and change the
    // vertical rhythm everywhere the ramp is used.
    const theme = read(GLOBALS);
    for (const size of ["caption", "footnote", "body", "callout", "title"]) {
      expect(theme, `--text-${size} has no paired line-height`).toContain(
        `--text-${size}--line-height:`,
      );
    }
  });
});

describe("Tailwind v4 renamed scales", () => {
  // #259 review finding: v4 shifted the shadow / radius / blur scales by one
  // step. The BARE utilities (rounded, shadow, backdrop-blur) were kept for
  // backward compatibility and still mean what they did in v3, but every v3
  // `-sm` now resolves to the next size up — the old value moved to `-xs`.
  //
  // This app had exactly one affected utility, backdrop-blur-sm (2 uses), now
  // backdrop-blur-xs. Reintroducing a `-sm` from this family would silently
  // change the rendered size, which no other test would catch.
  it("uses no v3-scale -sm utility whose meaning changed in v4", async () => {
    const { readdirSync, statSync, readFileSync: read } = await import("node:fs");
    const { join } = await import("node:path");
    const root = fileURLToPath(new URL("../../apps/desktop/src", import.meta.url));

    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((entry) => {
        const path = join(dir, entry);
        if (statSync(path).isDirectory()) return walk(path);
        return /\.tsx?$/.test(entry) ? [path] : [];
      });

    const shifted = /\b(shadow|rounded|blur|backdrop-blur|drop-shadow)-sm\b/;
    const offenders = walk(root).filter((file) => shifted.test(read(file, "utf8")));

    expect(
      offenders.map((f) => f.replace(`${root}/`, "")),
      "v4 shifted this scale: the v3 `-sm` value is now `-xs`. Rename to keep the rendered size.",
    ).toEqual([]);
  });
});
