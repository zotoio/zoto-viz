const path = require("node:path");
const { createRequire } = require("node:module");
const requireFromWeb = createRequire(path.join(__dirname, "../../../web/package.json"));
const { defineConfig } = requireFromWeb("vitest/config");

const repoRoot = path.join(__dirname, "../..");

module.exports = defineConfig({
  root: path.join(__dirname, "frontend"),
  assetsInclude: ["**/*.glsl", "**/*.yml"],
  server: { fs: { allow: [repoRoot] } },
  test: {
    environment: "happy-dom",
    setupFiles: [path.join(__dirname, "../../../web/src/test/setup.ts")],
    include: ["**/*.test.ts"],
  },
});
