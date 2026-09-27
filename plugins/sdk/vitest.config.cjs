const path = require("node:path");

module.exports = {
  root: __dirname,
  test: {
    environment: "node",
    include: ["pack-model-slot.test.ts"],
  },
  esbuild: {
    target: "es2022",
  },
};
