import type { StateMsg } from "../../core/types";
import type { ViewMode } from "../../core/modes";
import { isSysBase } from "../../core/modes";
import type { PluginView } from "../plugin";
import type { VizIdleConfig } from "../viz-host";
import { goldenLanFixture } from "./golden-lan-state";

export type PluginIdleConfig = VizIdleConfig;

/** Parse visualisation.yml ``idle`` — host golden LAN only today. */
export function parsePluginIdle(raw: unknown): PluginIdleConfig | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const doc = raw as Record<string, unknown>;
  if (doc.fixture === "host") return { fixture: "host" };
  return undefined;
}

/** Golden idle from viz.idle (demo packs) or visualisation.idle (graph / arcade). */
export function pluginIdleOf(spec: Pick<PluginView, "viz" | "idle"> | null | undefined): PluginIdleConfig | undefined {
  if (!spec) return undefined;
  if (spec.viz?.idle) return spec.viz.idle;
  return spec.idle;
}

function hasLiveGraph(state: StateMsg): boolean {
  const active = state.devices.filter((d) => d.online && d.packets > 0 && d.role !== "multicast");
  return active.length >= 3 || (state.flows?.length ?? 0) >= 2;
}

function hasLiveSources(state: StateMsg): boolean {
  const sources = state.sources ?? {};
  return Object.values(sources).some((s) => (s.items?.length ?? 0) > 0 || !!s.text);
}

/** True when the monitor snapshot cannot paint a graph / feed view on its own. */
export function stateNeedsGolden(state: StateMsg): boolean {
  return !hasLiveGraph(state);
}

export type HostIdleTarget =
  | { kind: "main" }
  | { kind: "view"; base: string };

export function hostIdleTargetForMode(mode: ViewMode): HostIdleTarget {
  const base = mode.graphBase;
  if (base === "bluetooth" || base === "wifi" || base === "cpu" || (base && isSysBase(base))) {
    return { kind: "view", base };
  }
  return { kind: "main" };
}

function targetKey(target: HostIdleTarget): string {
  return target.kind === "main" ? "main" : target.base;
}

function viewSliceEmpty(state: StateMsg, target: HostIdleTarget): boolean {
  if (target.kind === "view") {
    return (state.views?.[target.base]?.devices?.length ?? 0) === 0;
  }
  return stateNeedsGolden(state);
}

function applyGoldenSlice(live: StateMsg, target: HostIdleTarget): StateMsg {
  const golden = goldenLanFixture();
  if (target.kind === "view") {
    const slice = golden.views?.[target.base];
    if (!slice) return live;
    return { ...live, views: { ...live.views, [target.base]: slice } };
  }
  return {
    ...live,
    devices: golden.devices,
    flows: golden.flows,
    stats: golden.stats,
    ts: live.ts,
    iface: live.iface || golden.iface,
    interfaces: live.interfaces?.length ? live.interfaces : golden.interfaces,
    links: live.links ?? golden.links,
    network: live.network || golden.network,
    local_ip: live.local_ip || golden.local_ip,
    gateway: live.gateway || golden.gateway,
    uptime: live.uptime || golden.uptime,
    live: live.live,
    gateway_status: live.gateway_status,
    plugin_state: live.plugin_state,
    sdm: live.sdm,
    sources: hasLiveSources(live) ? live.sources : golden.sources,
    views: live.views,
  };
}

export type HostIdleViewRequest = {
  /** Mosaic tile slot id or `"hero"` for the focused main graph. */
  slotId: string;
  idle?: PluginIdleConfig;
  target: HostIdleTarget;
};

export type HostIdleMergeResult = {
  state: StateMsg;
  /** Tile slots (or `hero`) that are showing host-idle demo data this frame. */
  demoSlots: ReadonlySet<string>;
};

/** Per-view host golden: only declared `idle: fixture: host` slices, only when that slice is empty. */
export function mergeHostIdleForViews(live: StateMsg, requests: HostIdleViewRequest[]): HostIdleMergeResult {
  let out = live;
  const demoSlots = new Set<string>();
  const mergedTargets = new Set<string>();
  for (const req of requests) {
    if (!req.idle || !("fixture" in req.idle) || req.idle.fixture !== "host") continue;
    if (!viewSliceEmpty(out, req.target)) continue;
    const key = targetKey(req.target);
    if (!mergedTargets.has(key)) {
      out = applyGoldenSlice(out, req.target);
      mergedTargets.add(key);
    }
    demoSlots.add(req.slotId);
  }
  return { state: out, demoSlots };
}

/** Merge the shared golden LAN when idle is declared and live capture is empty (main graph only). */
export function withGoldenIfIdle(live: StateMsg, idle?: PluginIdleConfig): StateMsg {
  if (!idle || !("fixture" in idle) || idle.fixture !== "host" || !stateNeedsGolden(live)) return live;
  return applyGoldenSlice(live, { kind: "main" });
}
