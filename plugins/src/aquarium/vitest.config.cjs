const path = require("node:path");

/** Run from `web/`: `pnpm exec vitest run --config ../plugins/src/aquarium/vitest.config.cjs` */
module.exports = {
  root: path.join(__dirname),
  assetsInclude: ["**/*.glsl"],
  test: {
    environment: "happy-dom",
    include: ["frontend/**/*.test.ts"],
  },
};
