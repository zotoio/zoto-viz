import type { StateMsg } from "../../core/types";
import type { PluginView } from "../plugin";
import type { VizIdleConfig } from "../viz-host";
import { goldenLanFixture } from "./golden-lan-state";
import { smokeBackroomsHarnessArmed, smokeGoldenStateTs } from "../../core/smoke-harness";

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

/** Merge the shared golden LAN when idle is declared and live capture is empty. */
export function withGoldenIfIdle(live: StateMsg, idle?: PluginIdleConfig): StateMsg {
  if (!idle || !("fixture" in idle) || idle.fixture !== "host" || !stateNeedsGolden(live)) return live;
  const golden = goldenLanFixture();
  return {
    ...golden,
    ts: smokeBackroomsHarnessArmed() ? smokeGoldenStateTs() : live.ts,
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
  };
}
