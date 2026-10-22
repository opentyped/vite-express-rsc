import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";
import globals from "globals";
import hooks from "eslint-plugin-react-hooks";

export default tseslint.config(
  { ignores: ["**/node_modules/**", "**/dist/**", "test-results/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: globals.node },
    linterOptions: { reportUnusedDisableDirectives: "error" },
    rules: {
      "padding-line-between-statements": [
        "error",
        { blankLine: "always", prev: "import", next: "*" },
        { blankLine: "any", prev: "import", next: "import" },
        { blankLine: "always", prev: ["const", "let"], next: "*" },
        { blankLine: "any", prev: ["const", "let"], next: ["const", "let"] },
        { blankLine: "always", prev: "*", next: ["function", "class"] },
        { blankLine: "always", prev: "block-like", next: "*" },
        { blankLine: "always", prev: "expression", next: ["const", "let"] },
        {
          blankLine: "always",
          prev: "*",
          next: ["if", "for", "while", "switch", "try"],
        },
        { blankLine: "always", prev: "*", next: "return" },
        { blankLine: "always", prev: "*", next: "export" },
        { blankLine: "always", prev: "export", next: "*" },
      ],
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_" },
      ],
    },
  },
  {
    files: ["**/*.tsx"],
    plugins: { "react-hooks": hooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "error",
    },
  },
  {
    files: ["tests/**/*.ts", "**/runtime/browser.tsx"],
    languageOptions: { globals: globals.browser },
  },
  prettier,
  {
    rules: {
      curly: ["error", "all"],
      "lines-between-class-members": ["error", "always"],
    },
  },
);
