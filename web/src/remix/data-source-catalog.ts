import type { PluginView } from "../plugins/plugin";
import type { DataSourceBlock, DataSourceEntry } from "./remix-types";

export interface DataSourcePluginView {
  id: string;
  name: string;
  description?: string;
  dataSource: DataSourceBlock;
}

export function parseDataSourceBlock(raw: unknown): DataSourceBlock | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const block = raw as Record<string, unknown>;
  const sourcesRaw = block.sources;
  if (!Array.isArray(sourcesRaw) || !sourcesRaw.length) return null;
  const sources: DataSourceEntry[] = [];
  for (const row of sourcesRaw) {
    if (!row || typeof row !== "object") continue;
    const s = row as Record<string, unknown>;
    const id = String(s.id ?? "").trim();
    if (!id) continue;
    const hosts = Array.isArray(s.hosts) ? s.hosts.map((h) => String(h)) : [];
    sources.push({
      id,
      hosts,
      refreshSec: Number(s.refreshSec) || 60,
      apiKeyRequired: s.apiKeyRequired === true,
      outputShape: (s.outputShape === "headlines" || s.outputShape === "json")
        ? s.outputShape
        : "vizFrame",
      demoSnapshot: String(s.demoSnapshot ?? ""),
    });
  }
  return sources.length ? { sources } : null;
}

export function isDataSourcePlugin(spec: PluginView): boolean {
  return spec.pluginKind === "data-source" && !!spec.dataSource?.sources.length;
}

export function listDataSourcePlugins(specs: PluginView[]): DataSourcePluginView[] {
  const out: DataSourcePluginView[] = [];
  for (const spec of specs) {
    if (!isDataSourcePlugin(spec) || !spec.dataSource) continue;
    out.push({
      id: spec.id,
      name: spec.name,
      description: spec.hint,
      dataSource: spec.dataSource,
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export function listRemixVisualPacks(specs: PluginView[]): PluginView[] {
  return specs
    .filter((s) => s.pluginKind !== "data-source" && s.capabilities?.includes("viz.read"))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function sourceOptionsForPlugin(
  plugins: DataSourcePluginView[],
  pluginId: string,
): DataSourceEntry[] {
  return plugins.find((p) => p.id === pluginId)?.dataSource.sources ?? [];
}
