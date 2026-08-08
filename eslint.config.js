import fookie from "@fookiejs/eslint-plugin";
import tsParser from "@typescript-eslint/parser";

const relaxedForTests = {
  "fookie/no-async-without-await": "off",
  "fookie/min-function-lines": "off",
  "fookie/no-floating-promise": "off",
  "fookie/no-type-assertion": "off",
  "fookie/no-nullish-operators": "off",
  "fookie/no-null-undefined": "off",
  "fookie/no-empty-string": "off",
  "fookie/no-generic-names": "off",
  "fookie/no-typeof": "off",
  "fookie/no-unknown": "off",
  "fookie/no-comments": "off",
  "fookie/no-union-type": "off",
  "fookie/no-process-env": "off",
  "fookie/require-explicit-return-type": "off",
  "fookie/require-private-constructor": "off",
  "fookie/prefer-readonly-params": "off",
  "fookie/no-array-mutating-methods": "off",
  "fookie/no-map-set-mutation": "off",
  "fookie/no-class-mutation": "off",
  "fookie/no-spread": "off",
  "fookie/same-type-comparison": "off",
};

// src/ui/client is the dashboard's browser code. It used to live inside template
// literals, so the linter had never seen it; these are the rules it still breaks.
// They are switched off so the TypeScript migration stayed behaviour-for-behaviour,
// not so they stay off forever — each one is a burn-down item.
//
// no-null-undefined is not on this list any more: it was burnt down and is enabled,
// with one file-scoped exception for slot.ts below. no-map-set-mutation is here in
// its place, because the client builds local dictionaries it constructed itself,
// which is not the sharing that rule guards against — core's own src does the same.
const relaxedForBrowser = {
  "fookie/no-string-concat": "off",
  "fookie/no-empty-string": "off",
  "fookie/min-function-lines": "off",
  "fookie/require-boolean-condition": "off",
  "fookie/no-array-mutating-methods": "off",
  "fookie/no-union-type": "off",
  "fookie/no-legacy-globals": "off",
  "fookie/no-generic-names": "off",
  "fookie/no-nullish-operators": "off",
  "fookie/no-type-assertion": "off",
  "fookie/no-loop-func": "off",
  "fookie/no-map-set-mutation": "off",
  "fookie/no-placeholder-names": "off",
  "fookie/no-comments": "off",
  "fookie/same-type-comparison": "off",
  "fookie/no-unknown": "off",
  "fookie/no-nan-in-math-result": "off",
};

export default [
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      "coverage/**",
      "eslint.config.js",
      "scripts/**",
      "src/ui/client-bundle.generated.ts",
    ],
  },
  fookie.configs["recommended"],
  {
    files: ["src/**/*.ts"],
    ignores: ["src/ui/client/**"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        project: "./tsconfig.json",
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ["src/transport.ts", "src/server.ts"],
    rules: {
      "fookie/min-function-lines": "off",
      "fookie/no-unknown": "off",
    },
  },
  {
    files: ["src/ui/client/**/*.ts"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        project: "./tsconfig.client.json",
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: relaxedForBrowser,
  },
  {
    files: ["src/ui/client/slot.ts"],
    rules: {
      "fookie/no-null-undefined": "off",
    },
  },
  {
    files: ["tests/**/*.ts"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        project: "./tsconfig.lint.json",
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: relaxedForTests,
  },
];
