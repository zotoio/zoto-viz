const path = require("node:path");
const { createRequire } = require("node:module");
const requireFromWeb = createRequire(path.join(__dirname, "../../../web/package.json"));
const { defineConfig } = requireFromWeb("vitest/config");

module.exports = defineConfig({
  root: __dirname,
  assetsInclude: ["**/*.glsl", "**/*.yml"],
  server: {
    fs: { allow: [path.join(__dirname, "../../..")] },
  },
  test: {
    environment: "happy-dom",
    setupFiles: [path.join(__dirname, "../../../web/src/test/setup.ts")],
    include: ["frontend/**/*.test.ts"],
  },
});
