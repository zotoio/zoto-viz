/// <reference types="vitest/config" />
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const monitorPort = Number(process.env.ZOTO_VIZ_PORT || 7020);
const webRoot = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(webRoot, "..");

function gitShortRev(): string {
  try {
    const sha = execFileSync("git", ["rev-parse", "--short", "HEAD"], {
      cwd: repoRoot,
      encoding: "utf8",
    }).trim();
    return sha || "dev";
  } catch {
    return "dev";
  }
}

export default defineConfig({
  define: {
    "import.meta.env.VITE_ZOTO_REV": JSON.stringify(gitShortRev()),
    __VIZ_BUILD_COUNTERS__: JSON.stringify(Boolean(process.env.VITEST)),
  },
  server: {
    port: 5173,
    fs: { allow: [repoRoot] },
    proxy: {
      "/ws": { target: `ws://127.0.0.1:${monitorPort}`, ws: true },
      "/api": { target: `http://127.0.0.1:${monitorPort}` },
      "/pack-assets": { target: `http://127.0.0.1:${monitorPort}` },
    },
  },
  // `?init` is Vite's WebAssembly loader; listing .wasm as an asset also lets tests pull the same
  // bytes in with `?inline` (no Node fs types in the browser tsconfig)
  assetsInclude: ["**/*.wasm", "**/*.glsl"],
  build: { outDir: "dist", emptyOutDir: true, sourcemap: false,
    rollupOptions: {
      input: {
        main: path.resolve(webRoot, "index.html"),
        "plugin-sandbox": path.resolve(webRoot, "plugin-sandbox.html"),
      },
    },
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          environment: "happy-dom",
          setupFiles: ["src/test/setup.ts"],
          include: ["src/**/*.test.ts"],
          exclude: ["src/plugins/nixie-local-wall-tz-sydney.test.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "tz-sydney",
          include: ["src/plugins/nixie-local-wall-tz-sydney.test.ts"],
          environment: "node",
          pool: "forks",
          env: { TZ: "Australia/Sydney" },
        },
      },
    ],
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
