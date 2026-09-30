import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { themeById } from "../core/themes";
import { hostLookUniforms } from "./pack-sky-lan-frame-test-helper";
import type { PluginSkySmokeUniforms } from "./plugin-sky-smoke-render";
import type { VizDataFrame, VizUniformValue } from "./viz-host";
import { runPackFrameHandler } from "./viz-pack-host";

/**
 * blob-mesh look for the sky rows (#174): read from the pack's visualisation.yml and the pack's
 * own onFrame writes, so no row carries a copy of skyBright or the pack's uBright.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
export const BLOB_MESH_LOOK_YML = readFileSync(path.resolve(here, "../../../plugins/src/blob-mesh/visualisation.yml"), "utf8");

/** A number under `look:` in the pack's visualisation.yml (skyBright, skyOpacity, ...). */
export function blobMeshLookNumber(key: string): number {
  const m = BLOB_MESH_LOOK_YML.match(new RegExp(`^\\s+${key}: ([0-9.]+)\\s*$`, "m"));
  if (!m) throw new Error(`blob-mesh visualisation.yml: look.${key} not found`);
  return Number(m[1]);
}

export const BLOB_MESH_LOOK_THEME = themeById(BLOB_MESH_LOOK_YML.match(/^\s+theme: ([a-z0-9-]+)\s*$/m)?.[1]);

/** The pack look as the host applies it: yml skyBright / skyOpacity, the yml theme's scene rim and bg. */
export function blobMeshAppLook(skyBright = blobMeshLookNumber("skyBright")): PluginSkySmokeUniforms {
  const t = BLOB_MESH_LOOK_THEME;
  return hostLookUniforms({ skyBright, skyOpacity: blobMeshLookNumber("skyOpacity"), rim: t.scene.rim, bg: Number.parseInt(t.ui.bg.slice(1), 16) });
}

/** What the pack's onFrame writes for a frame (runPackFrameHandler, the host mirror of frontend/index.ts). */
export function blobMeshPackWrites(frame: VizDataFrame): Record<string, VizUniformValue> {
  const w: Record<string, VizUniformValue> = {};
  runPackFrameHandler("blob-mesh", frame, { writeBuffer: () => {}, writeUniform: (n, v) => { w[n] = v; }, writeParticles: () => {} });
  return w;
}

/**
 * The uniforms the plugin sky actually draws with once the pack writes (#180 H1 on main): the
 * host look (yml skyBright / skyOpacity, theme bg) times the pack's own uBright / uOpacity (pack
 * default 1), and the pack's uTime / uAudio / uAccent / uBg where it writes them.
 */
export function blobMeshPackLook(frame: VizDataFrame, skyBright = blobMeshLookNumber("skyBright")): { u: PluginSkySmokeUniforms; packBright: number } {
  const w = blobMeshPackWrites(frame);
  const host = { ...blobMeshAppLook(skyBright), uAudio: frame.audio };
  const num = (k: string) => (typeof w[k] === "number" ? (w[k] as number) : undefined);
  const vec = (k: string) => (Array.isArray(w[k]) ? (w[k] as [number, number, number]) : undefined);
  const packBright = num("uBright") ?? 1;
  return {
    packBright,
    u: {
      uTime: num("uTime") ?? host.uTime,
      uOpacity: host.uOpacity * (num("uOpacity") ?? 1),
      uBright: host.uBright * packBright,
      uAudio: num("uAudio") ?? host.uAudio,
      uAccent: vec("uAccent") ?? host.uAccent,
      uBg: vec("uBg") ?? host.uBg,
    },
  };
}
