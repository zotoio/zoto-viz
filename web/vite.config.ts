/// <reference types="vitest/config" />
import { defineConfig } from "vite";

const monitorPort = Number(process.env.ZOTO_VIZ_PORT || 7020);

export default defineConfig({
  server: {
    port: 5173,
    proxy: {
      "/ws": { target: `ws://127.0.0.1:${monitorPort}`, ws: true },
      "/api": { target: `http://127.0.0.1:${monitorPort}` },
    },
  },
  build: { outDir: "dist", emptyOutDir: true, sourcemap: false },
  test: {
    environment: "happy-dom",
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "text-summary"],
      include: [
        "src/camera/want.ts",
        "src/core/http.ts",
        "src/core/collapse.ts",
        "src/core/fps.ts",
        "src/core/redact.ts",
        "src/core/themes.ts",
        "src/core/types.ts",
        "src/inspect/decode.ts",
        "src/plugins/host.ts",
        "src/plugins/plugin-ui.ts",
        "src/plugins/plugin.ts",
        "src/plugins/sdk.ts",
        "src/ui/ui.ts",
      ],
      exclude: ["src/**/*.test.ts", "src/**/*.d.ts"],
      reportsDirectory: "./coverage",
      all: true,
      thresholds: {
        lines: 80,
        statements: 80,
        functions: 80,
        branches: 70,
      },
    },
  },
});
