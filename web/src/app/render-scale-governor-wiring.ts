import type { Mosaic } from "../graph/mosaic";
import type { NetScene } from "../graph/scene";
import {
  hostRenderScaleGovernorEnabled,
  refreshHostRenderScaleGovernorEnabled,
  setVizGovernorSetting,
  loadVizGovernorSetting,
} from "../plugins/render-scale-governor-enable";
import {
  tickRenderScalePanes,
  type RenderScalePane,
} from "../plugins/render-scale-host";
import type { PluginView } from "../plugins/plugin";
import type { VizFrameBudgetStats } from "../plugins/viz-host";
import type { VizHud } from "../ui/viz-hud";
import { Toggle } from "../ui/ui";
import { addPresentListener } from "../core/fps";

export type RenderScaleGovernorHost = {
  scene: NetScene;
  mosaic: Pick<Mosaic, "on" | "graphs" | "heroMode" | "focusedId" | "graphScene"> | null;
  pluginSpecForMode: (modeId: string) => PluginView | null;
  vizHud: VizHud;
};

let governorEnabledTickCount = 0;

export function resetRenderScaleGovernorWiringForTests(): void {
  governorEnabledTickCount = 0;
}

export function renderScaleGovernorEnabledTickCountForTests(): number {
  return governorEnabledTickCount;
}

export function bootRenderScaleGpuTimer(scene: NetScene, gl: WebGL2RenderingContext | null | undefined): void {
  const gpuOk = !!gl?.getExtension("EXT_disjoint_timer_query_webgl2");
  scene.renderScaleState.setGpuTimerAvailable(gpuOk);
}

export function collectRenderScalePanes(host: RenderScaleGovernorHost): RenderScalePane[] {
  if (host.mosaic?.on) return host.mosaic.graphs.filter((s) => s.renderScaleActive);
  return host.scene.renderScaleActive ? [host.scene] : [];
}

export function focusedRenderScene(host: RenderScaleGovernorHost): NetScene {
  if (!host.mosaic?.on) return host.scene;
  return host.mosaic.graphScene(host.mosaic.focusedId)
    ?? host.mosaic.graphScene(host.mosaic.heroMode)
    ?? host.mosaic.graphs[0]
    ?? host.scene;
}

export function syncPaneRenderScale(target: NetScene, spec: PluginView | null): void {
  target.configureRenderScale(spec?.renderScale ?? null);
  target.setPluginSkyContract(spec?.viz?.uniforms);
}

export function syncHostRenderGovernorForSpec(host: RenderScaleGovernorHost, spec: PluginView | null): void {
  const cfg = spec?.renderScale;
  host.vizHud.setBudgetOverlayVisible(!!cfg);
  syncPaneRenderScale(host.scene, spec);
  if (host.mosaic?.on) {
    for (const s of host.mosaic.graphs) {
      const m = s.currentMode;
      syncPaneRenderScale(s, m.pluginId ? host.pluginSpecForMode(m.id) : null);
    }
  }
}

export function applyHostRenderScaleGovernor(on: boolean, host: RenderScaleGovernorHost): void {
  setVizGovernorSetting(on);
  refreshHostRenderScaleGovernorEnabled();
  const panes = collectRenderScalePanes(host);
  tickRenderScalePanes(panes, performance.now(), on);
}

/** Present-to-present hook: pane frame budgets + page arbiter (PR #23). */
export function runRenderScaleGovernorPresentTick(
  host: RenderScaleGovernorHost,
  ts: number,
  now = performance.now(),
): void {
  const panes = collectRenderScalePanes(host);
  for (const p of panes) p.renderScaleState.onPaneFrame(ts);
  const enabled = hostRenderScaleGovernorEnabled();
  if (enabled) governorEnabledTickCount++;
  tickRenderScalePanes(panes, now, enabled);
}

/** Production hook: one governor tick per display present (same as `main.ts`). */
export function bindRenderScaleGovernorPresentListener(host: RenderScaleGovernorHost): () => void {
  return addPresentListener((ts) => runRenderScaleGovernorPresentTick(host, ts));
}

export function vizHudGovernorTickFields(
  host: RenderScaleGovernorHost,
  hostBudgetStats: VizFrameBudgetStats,
): { renderScale: number | null; governorEnabled: boolean; stats: VizFrameBudgetStats } {
  const govOn = hostRenderScaleGovernorEnabled();
  const focusRs = focusedRenderScene(host).renderScaleState;
  const packGov = focusRs.hasGovernor;
  const renderScale = packGov ? (govOn ? focusRs.renderScale : 1) : null;
  const stats = packGov
    ? { ...focusRs.stats(), skipped: hostBudgetStats.skipped }
    : hostBudgetStats;
  return { renderScale, governorEnabled: govOn, stats };
}

export function createVizGovernorToggle(host: RenderScaleGovernorHost): Toggle {
  return new Toggle({
    id: "viz-governor",
    label: "render governor",
    title: "Adaptive render.scale governor (off by default). Also ?vizGovernor=1 on the URL for a one-off local GPU run.",
    checked: loadVizGovernorSetting(),
    onChange: (on) => applyHostRenderScaleGovernor(on, host),
  });
}

export function refreshRenderScaleGovernorFromUrl(): void {
  refreshHostRenderScaleGovernorEnabled();
}
