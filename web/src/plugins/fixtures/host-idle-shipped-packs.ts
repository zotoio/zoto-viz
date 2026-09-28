import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import yaml from "yaml";
import type { ViewMode } from "../../core/modes";
import { compilePlugin, type PluginView } from "../plugin";
import { toPluginView } from "../plugin-visualisation";
import { parseVizContract, VIZ_CONTRACT_VERSION, VIZ_UBO } from "../viz-host";
import { parsePluginIdle, pluginIdleOf } from "./golden-state";

const HOST_IDLE_RE = /fixture:\s*host/;

/** Pack ids under ``plugins/src`` whose plugin.yml or visualisation.yml declares host idle. */
export function listHostIdleShippedPackIds(repoRoot: string): string[] {
  const packsRoot = path.join(repoRoot, "plugins/src");
  return readdirSync(packsRoot)
    .filter((name) => {
      const dir = path.join(packsRoot, name);
      const pluginPath = path.join(dir, "plugin.yml");
      if (!existsSync(pluginPath)) return false;
      const texts = [readFileSync(pluginPath, "utf8")];
      const visPath = path.join(dir, "visualisation.yml");
      if (existsSync(visPath)) texts.push(readFileSync(visPath, "utf8"));
      return texts.some((t) => HOST_IDLE_RE.test(t));
    })
    .sort();
}

export function loadShippedPackSpec(repoRoot: string, packId: string): PluginView {
  const dir = path.join(repoRoot, "plugins/src", packId);
  const pluginPath = path.join(dir, "plugin.yml");
  const pluginDoc = yaml.parse(readFileSync(pluginPath, "utf8")) as Record<string, unknown>;
  const row: Record<string, unknown> = { ...pluginDoc };
  const visPath = path.join(dir, "visualisation.yml");
  if (existsSync(visPath)) {
    const vis = yaml.parse(readFileSync(visPath, "utf8")) as Record<string, unknown>;
    if (vis.engine === "topology") {
      vis.engine = "graph";
      vis.base = vis.base ?? "topology";
    }
    row.visualisation = vis;
  }
  const spec = toPluginView(row);
  const pluginViz = pluginDoc.viz;
  if (pluginViz && typeof pluginViz === "object" && !Array.isArray(pluginViz)) {
    const vizDoc = pluginViz as Record<string, unknown>;
    const idle = parsePluginIdle(vizDoc.idle);
    const contract = parseVizContract(vizDoc);
    if (contract) {
      spec.viz = idle ? { ...contract, idle } : contract;
    } else if (idle) {
      spec.viz = {
        contract: VIZ_CONTRACT_VERSION,
        graphWalk: false,
        maxBuffers: 1,
        maxBufferFloats: 8,
        maxParticles: 0,
        uniforms: [],
        ubo: VIZ_UBO,
        idle,
      };
    }
  }
  return spec;
}

export function compileShippedPackMode(repoRoot: string, packId: string): ViewMode {
  const spec = loadShippedPackSpec(repoRoot, packId);
  try {
    return compilePlugin(spec);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.includes("unknown visualisation.engine")) throw err;
    return {
      id: `plugin:${spec.id}`,
      label: spec.name,
      hint: spec.hint ?? "",
      pluginId: spec.id,
      graphBase: spec.base,
      legend: () => [],
    };
  }
}

export function hostIdleOfShippedPack(repoRoot: string, packId: string) {
  return pluginIdleOf(loadShippedPackSpec(repoRoot, packId));
}
