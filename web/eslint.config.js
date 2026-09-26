import tsParser from "@typescript-eslint/parser";

/** Mint-only file and tests are ignored; all other production TS is checked. */
export default [
  {
    ignores: ["dist/**", "**/*.test.ts", "src/core/time-ms.ts"],
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
      "no-restricted-syntax": [
        "error",
        {
          selector: 'TSAsExpression[typeAnnotation.typeName.name="FrameTs"]',
          message:
            "Do not cast to FrameTs; mint only via frameTsFromRaf() in core/time-ms.ts (host / pane rAF entry).",
        },
      ],
    },
  },
];
