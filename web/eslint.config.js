import tsParser from "@typescript-eslint/parser";
import { brandCastSyntaxRules, brandMintIgnoreGlobs } from "./eslint-brand-mints.js";

export default [
  {
    ignores: brandMintIgnoreGlobs(),
  },
  {
    files: ["src/**/*.ts"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
      },
    },
    rules: {
      "no-restricted-syntax": ["error", ...brandCastSyntaxRules()],
    },
  },
];
