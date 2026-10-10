import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import globals from "globals";
import tseslint from "typescript-eslint";

export default defineConfig([
  globalIgnores(["dist/**", "node_modules/**"]),
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    languageOptions: {
      globals: globals.node,
    },
    rules: {
      // Unused arguments named with a leading underscore are intentional (Express handlers).
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      // A promise nobody awaits loses its error; the server and scripts use `void` on purpose.
      "no-void": ["error", { allowAsStatement: true }],
      eqeqeq: ["error", "always"],
    },
  },
]);
