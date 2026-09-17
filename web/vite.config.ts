/// <reference types="vitest/config" />
import { defineConfig } from "vite";

const monitorPort = Number(process.env.ZOTO_VIZ_PORT || 7020);

export default defineConfig({
  // Expose VITE_TYPESAFE_API_KEY and TYPESAFE_API_KEY to import.meta.env in the client bundle.
  envPrefix: ["VITE_", "TYPESAFE_"],
  server: {
    port: 5173,
    proxy: {
      "/ws": { target: `ws://127.0.0.1:${monitorPort}`, ws: true },
      "/api": { target: `http://127.0.0.1:${monitorPort}` },
    },
  },
  // `?init` is Vite's WebAssembly loader; listing .wasm as an asset also lets tests pull the same
  // bytes in with `?inline` (no Node fs types in the browser tsconfig)
  assetsInclude: ["**/*.wasm"],
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
