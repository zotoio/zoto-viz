const path = require("node:path");

/** Pack-local vitest (run from repo: `pnpm exec vitest run --config plugins/src/metro-lines/vitest.config.cjs` in web/). */
module.exports = {
  root: path.join(__dirname, "frontend"),
  test: {
    environment: "happy-dom",
    include: ["**/*.test.ts"],
  },
};
