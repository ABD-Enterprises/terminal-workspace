import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        "neutral-925": "#111111"
      }
    }
  },
  plugins: []
} satisfies Config;
