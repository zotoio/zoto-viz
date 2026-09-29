import type { BackdropKind } from "./backdrop";

export type PaneKind = "graph" | "arcade" | "empty";

export type PaneFault = "unbound" | "no-sky" | "no-data";

export interface PaneStartupSnap {
  id: string;
  kind: PaneKind;
  bound: boolean;
  /** Plugin shader is still fetching / compiling. */
  skyPending?: boolean;
  stageOnly: boolean;
  backdrop: string;
  pluginSkyId: string | null;
  pluginSkyWanted: boolean;
  nodes: number;
  hasSnapshot: boolean;
}

export interface PaneRecovery {
  rematch: boolean;
  hostSky: boolean;
  flush: boolean;
}

const SHARED_SKY = new Set(["none", "plugin", "custom", "dynamic"]);

/** Startup check so a tile is not left chrome-only, shader-black, or empty of its graph. */
export function inspectPaneStartup(s: PaneStartupSnap): PaneFault | null {
  if (!s.bound || s.kind === "empty") return "unbound";
  if (s.skyPending) return null;
  if (s.pluginSkyWanted && !s.pluginSkyId) return "no-sky";
  if (s.backdrop === "plugin" && !s.pluginSkyId) return "no-sky";
  if (s.kind === "graph" && s.hasSnapshot && s.nodes < 1 && !s.stageOnly) return "no-data";
  return null;
}

/**
 * ``packSky``: the pane's view draws its own sky (``look.backdrop: plugin``). That pane never
 * gets a built-in stand-in; it keeps the theme background until its own sky is ready.
 */
export function paneRecovery(fault: PaneFault, packSky = false): PaneRecovery {
  if (fault === "unbound") return { rematch: true, hostSky: false, flush: false };
  if (fault === "no-sky") return { rematch: false, hostSky: !packSky, flush: false };
  return { rematch: false, hostSky: !packSky, flush: true };
}

/** Next unused graph catalog id so a dead arcade / chrome-only tile becomes a scene. */
export function nextGraphTile(
  used: readonly string[],
  pool: readonly string[],
  graph: (id: string) => boolean,
): string | null {
  const taken = new Set(used);
  return pool.find((id) => graph(id) && !taken.has(id)) ?? null;
}

/** Distinct host sky when a plugin shader never landed. */
export function nextHostSky(
  used: readonly string[],
  pool: readonly BackdropKind[],
  avoid?: string,
): BackdropKind {
  const taken = new Set(used);
  const host = pool.filter((k) => !SHARED_SKY.has(k));
  return host.find((k) => !taken.has(k) && k !== avoid)
    ?? host.find((k) => !taken.has(k))
    ?? host.find((k) => k !== avoid)
    ?? host[0]
    ?? "aurora";
}
