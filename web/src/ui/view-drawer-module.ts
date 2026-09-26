import type { PluginField } from "../core/modes";
import type { PluginLook, PluginView } from "../plugins/plugin";
import { pluginViewKnobs } from "../plugins/plugin-visualisation";
import { fillPluginFields } from "../plugins/plugin-ui";
import type { PackWallScope } from "../plugins/instances";

let createElementCalls = 0;
let rebuilds = 0;

export function resetViewDrawerModuleMetrics(): void {
  createElementCalls = 0;
  rebuilds = 0;
}

export function readViewDrawerModuleMetrics(): { createElementCalls: number; rebuilds: number } {
  return { createElementCalls, rebuilds };
}

export function recordViewDrawerRebuild(): void {
  rebuilds += 1;
}

function createEl<K extends keyof HTMLElementTagNameMap>(tag: K): HTMLElementTagNameMap[K] {
  createElementCalls += 1;
  return document.createElement(tag);
}

function packLayerNames(spec: PluginView): string[] {
  const layers: string[] = [];
  if (spec.has_datasource) layers.push("datasource");
  if (spec.has_backend || spec.service) layers.push("backend");
  if (spec.has_frontend || spec.has_sky || spec.has_sky_shader) layers.push("frontend");
  layers.push("view");
  return layers;
}

function pluginLayer(id: string, title: string, hint: string): HTMLElement {
  const wrap = createEl("div");
  wrap.className = "plugin-layer";
  wrap.dataset.layer = id;
  const h = createEl("div");
  h.className = "sec-title";
  h.textContent = title;
  const p = createEl("div");
  p.className = "sec-hint";
  p.textContent = hint;
  wrap.append(h, p);
  return wrap;
}

export type ViewDrawerBuildInput = {
  spec: PluginView | null;
  fields?: PluginField[];
  look?: PluginLook | null;
  extras?: HTMLElement[];
  wallScope?: PackWallScope;
  onPluginPersist: (id: string, values: Record<string, string>) => void;
  onPluginFieldInput?: () => void;
  viewMosaicSec: HTMLElement | null;
};

/** Build view drawer DOM under `host` (replaces children). */
export function rebuildViewDrawerContent(host: HTMLDivElement, input: ViewDrawerBuildInput): void {
  recordViewDrawerRebuild();
  host.replaceChildren();
  const { spec, fields, look, extras, wallScope, onPluginPersist, onPluginFieldInput, viewMosaicSec } = input;
  if (spec) {
    const layers = packLayerNames(spec);
    host.append(pluginLayer(
      "pack",
      spec.name,
      `Plugin pack · ${layers.join(" · ")}. Datasource, backend, and frontend are reusable; this tab is the selected view. Wall composes other views.`,
    ));
  }
  if (look && Object.keys(look).length) {
    const front = pluginLayer(
      "frontend",
      "Frontend",
      spec
        ? `Look pins from ${spec.name}'s visualisation — they override matching Motion / Appearance controls while this view is selected.`
        : "Look pins from the plugin pack — they override matching Motion / Appearance controls while selected.",
    );
    const row = createEl("div");
    row.className = "pin-chips";
    for (const [k, v] of Object.entries(look)) {
      if (v === undefined) continue;
      const c = createEl("span");
      c.className = "pin-chip";
      c.textContent = `${k}: ${String(v)}`;
      row.appendChild(c);
    }
    front.append(row);
    host.append(front);
  }
  const extra = extras?.filter(Boolean) ?? [];
  if (spec) {
    const view = pluginLayer(
      "view",
      "View",
      spec.instanceId && spec.instanceId !== spec.id
        ? `Instance ${spec.instanceId} of ${spec.id}. Corner cog on a mosaic tile opens that tile's view.`
        : "This catalog row. Corner cog on a mosaic tile opens that tile's view.",
    );
    fillPluginFields(view, spec, pluginViewKnobs(spec, fields), onPluginPersist, {
      skipEmpty: extra.length > 0,
      wallScope,
      onFieldInput: onPluginFieldInput,
    });
    if (extra.length) {
      const sec = createEl("div");
      sec.className = "sec";
      const row = createEl("div");
      row.className = "sec-controls";
      for (const el of extra) row.appendChild(el);
      sec.append(row);
      const prompt = view.querySelector(".view-prompt");
      if (prompt) view.insertBefore(sec, prompt);
      else view.append(sec);
    }
    host.append(view);
  } else if (!look && !extra.length && !viewMosaicSec) {
    const empty = createEl("div");
    empty.className = "sec";
    empty.innerHTML = `<div class="sec-title">View</div><div class="sec-hint">This view has no extra fields. The cog next to the view menu or on a mosaic tile opens this tab. Network and system visibility live under Graph. Host and subnet filters live under Privacy.</div>`;
    host.append(empty);
  }
  if (viewMosaicSec) host.append(viewMosaicSec);
}
