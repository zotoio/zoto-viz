import type { PluginView } from "../plugins/plugin";
import { pluginViewKnobs } from "../plugins/plugin-visualisation";
import { fillPluginFields } from "../plugins/plugin-ui";
import type { DrawerContext } from "./drawer-context";
import { isNestCamsDrawerContext } from "./drawer-context";

function packLayerNames(spec: PluginView): string[] {
  const layers: string[] = [];
  if (spec.has_datasource) layers.push("datasource");
  if (spec.has_backend || spec.service) layers.push("backend");
  if (spec.has_frontend || spec.has_sky || spec.has_sky_shader) layers.push("frontend");
  layers.push("view");
  return layers;
}

function pluginLayer(id: string, title: string, hint: string): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "plugin-layer";
  wrap.dataset.layer = id;
  const h = document.createElement("div");
  h.className = "sec-title";
  h.textContent = title;
  const p = document.createElement("div");
  p.className = "sec-hint";
  p.textContent = hint;
  wrap.append(h, p);
  return wrap;
}

export type ViewDrawerRuntime = {
  onPluginPersist: (id: string, values: Record<string, string>) => void;
  onPluginFieldInput?: (key: string, value: string) => void;
  viewMosaicSec: HTMLElement | null;
};

export type ViewDrawerBuildInput = DrawerContext & ViewDrawerRuntime;

/** Clear plugin layers; keep optional mosaic section (initial / unbound view pane). */
export function clearViewDrawerHost(host: HTMLDivElement, viewMosaicSec: HTMLElement | null): void {
  host.replaceChildren();
  if (!viewMosaicSec) {
    const empty = document.createElement("div");
    empty.className = "sec";
    empty.innerHTML = `<div class="sec-title">View</div><div class="sec-hint">This view has no extra fields. The cog next to the view menu or on a mosaic tile opens this tab. Network and system visibility live under Graph. Host and subnet filters live under Privacy.</div>`;
    host.append(empty);
  }
  if (viewMosaicSec) host.append(viewMosaicSec);
}

/** Build view drawer DOM under `host` (replaces children). */
export function rebuildViewDrawerContent(host: HTMLDivElement, input: ViewDrawerBuildInput): void {
  host.replaceChildren();
  const {
    spec,
    fields,
    look,
    extras,
    wallScope,
    draftValues,
    onPluginPersist,
    onPluginFieldInput,
    viewMosaicSec,
  } = input;
  const devices = isNestCamsDrawerContext(input) ? [...input.devices] : undefined;
  const layers = packLayerNames(spec);
  host.append(pluginLayer(
    "pack",
    spec.name,
    `Plugin pack · ${layers.join(" · ")}. Datasource, backend, and frontend are reusable; this tab is the selected view. Wall composes other views.`,
  ));
  if (look && Object.keys(look).length) {
    const front = pluginLayer(
      "frontend",
      "Frontend",
      `Look pins from ${spec.name}'s visualisation — they override matching Motion / Appearance controls while this view is selected.`,
    );
    const row = document.createElement("div");
    row.className = "pin-chips";
    for (const [k, v] of Object.entries(look)) {
      if (v === undefined) continue;
      const c = document.createElement("span");
      c.className = "pin-chip";
      c.textContent = `${k}: ${String(v)}`;
      row.appendChild(c);
    }
    front.append(row);
    host.append(front);
  }
  const extra = extras?.filter(Boolean) ?? [];
  const view = pluginLayer(
    "view",
    "View",
    spec.instanceId && spec.instanceId !== spec.id
      ? `Instance ${spec.instanceId} of ${spec.id}. Corner cog on a mosaic tile opens that tile's view.`
      : "This catalog row. Corner cog on a mosaic tile opens that tile's view.",
  );
  fillPluginFields(view, spec, pluginViewKnobs(spec, fields), onPluginPersist, {
    skipEmpty: extra.length > 0,
    devices,
    wallScope,
    draftValues,
    onFieldInput: onPluginFieldInput,
  });
  if (extra.length) {
    const sec = document.createElement("div");
    sec.className = "sec";
    const row = document.createElement("div");
    row.className = "sec-controls";
    for (const el of extra) row.appendChild(el);
    sec.append(row);
    const prompt = view.querySelector(".view-prompt");
    if (prompt) view.insertBefore(sec, prompt);
    else view.append(sec);
  }
  host.append(view);
  if (viewMosaicSec) host.append(viewMosaicSec);
}
