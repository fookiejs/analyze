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

export default [
  {
    ignores: ["dist/**", "node_modules/**", "coverage/**", "eslint.config.js"],
  },
  fookie.configs["recommended"],
  {
    files: ["src/**/*.ts"],
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
