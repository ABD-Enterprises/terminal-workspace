// #259 (Tailwind v4): the PostCSS plugin moved to its own package, and v4
// handles `@import` inlining and vendor prefixing itself — so `autoprefixer` is
// gone from both this chain and the manifest rather than left running as a
// redundant pass.
export default {
  plugins: {
    "@tailwindcss/postcss": {}
  }
};
