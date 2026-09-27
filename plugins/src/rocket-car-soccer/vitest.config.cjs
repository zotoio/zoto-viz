const path = require("node:path");

/** Pack-local vitest (run from repo root via tests/test_rocket_car_soccer_pack.py or web vitest --config). */
module.exports = {
  root: __dirname,
  test: {
    environment: "happy-dom",
    include: ["frontend/**/*.test.ts"],
  },
  esbuild: {
    target: "es2022",
  },
  resolve: {
    alias: {
      "@sdk": path.join(__dirname, "../../sdk"),
    },
  },
};
