import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "node_modules",
      "apps/desktop/dist",
      "dist",
      "coverage",
      "src-tauri/target",
      // #267: `orc claim` puts a full second checkout here, tsconfig.json and
      // all. Without this, typescript-eslint finds two candidate
      // tsconfigRootDirs and fails to parse EVERY TypeScript file in the repo —
      // 536 parse errors on files the change never touched, scaling with the
      // number of live worktrees. Already in .gitignore; eslint walks the
      // filesystem rather than asking git, so it needs telling separately.
      //
      // Both forms on purpose. The bare name prunes the directory during a
      // traversal like `eslint .`; only the `/**` form also ignores a file
      // inside it that was named explicitly on the command line.
      ".worktrees",
      ".worktrees/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{js,mjs,cjs}"],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
  {
    files: ["apps/desktop/src/**/*.{ts,tsx}", "apps/desktop/vite.config.ts"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    plugins: {
      "react-hooks": reactHooks,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
    },
  },
  {
    files: ["apps/desktop/src/store/**/*.test.ts"],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  }
);
