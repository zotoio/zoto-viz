const path = require("node:path");

module.exports = {
  root: __dirname,
  test: {
    environment: "node",
    include: ["pack-model-slot.test.ts", "pack-host-mesh.test.ts", "host-mesh-frame.test.ts", "talker-slots.test.ts"],
  },
  esbuild: {
    target: "es2022",
  },
};
