import type { Config } from "tailwindcss";

// #110: design tokens. Tailwind's default spacing scale already follows an
// 8pt grid (1=4px, 2=8px, 3=12px, 4=16px, 6=24px); the tokens below add the
// missing scales — a semantic type ramp, a three-step radius scale, and a
// collapsed letter-spacing set — so components stop reaching for ad-hoc
// `text-[11px]` / `rounded-[18px]` / `tracking-[0.22em]` values. Density is
// driven from CSS variables (see styles/globals.css), keyed off a single
// `data-density` attribute rather than scattered compact/comfortable
// ternaries.
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        "neutral-925": "#111111"
      },
      // Type ramp — replaces ad-hoc 10/11/12/13/16px font sizes.
      fontSize: {
        caption: ["0.625rem", { lineHeight: "0.875rem" }], // 10px
        footnote: ["0.6875rem", { lineHeight: "1rem" }], // 11px
        body: ["0.75rem", { lineHeight: "1.125rem" }], // 12px
        callout: ["0.8125rem", { lineHeight: "1.25rem" }], // 13px
        title: ["1rem", { lineHeight: "1.5rem" }] // 16px
      },
      // Three-step radius scale — controls, surfaces, panels.
      borderRadius: {
        control: "0.625rem", // 10px — buttons, inputs, list rows
        surface: "0.875rem", // 14px — sections, cards
        panel: "1.25rem" // 20px — large containers
      },
      // Collapsed to two values (was 0.14–0.26em scattered across the app).
      letterSpacing: {
        label: "0.16em", // section eyebrows / uppercase labels
        brand: "0.26em" // the single brand wordmark
      }
    }
  },
  plugins: []
} satisfies Config;
