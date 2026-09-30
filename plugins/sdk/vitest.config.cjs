const path = require("node:path");

module.exports = {
  root: __dirname,
  test: {
    // Also a project of web's `pnpm test` (web/vite.config.mjs); this file stays the sdk's solo config.
    name: "sdk",
    environment: "node",
    include: ["pack-model-slot.test.ts", "pack-host-mesh.test.ts", "host-mesh-frame.test.ts", "talker-slots.test.ts"],
  },
  esbuild: {
    target: "es2022",
  },
};
