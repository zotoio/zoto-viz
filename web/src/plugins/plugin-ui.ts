import {
  configStoreId,
  fieldDefault,
  loadPluginConfig,
  removePluginConfigKeys,
  specCaption,
  writePluginConfig,
  type PluginView,
} from "./plugin";
import { packScopeNoteText, type PackWallScope } from "./instances";
import type { PluginField } from "../core/modes";
import { Select, Slider, TextField, Toggle } from "../ui/ui";
import { mountNestCamFields } from "./nest-cams-ui";
import type { SdmDevice } from "./nest-cams-look";
import {
  applyPresetToValues,
  buildPluginHudCaption,
  CUSTOM_PRESET_ID,
  fieldBaselineForDirty,
  hasDeclaredSettings,
  markPresetConsistency,
  orderedSectionTitles,
  packConfigValues,
  popUndoSnapshot,
  PRESET_BASE_META_KEY,
  pushUndoSnapshot,
  randomiseDeclaredConfig,
  rememberSectionOpen,
  resetDeclaredConfig,
  presetById,
  sectionOpenState,
  showSettingsToolbar,
  undoRingDepth,
  isMetaConfigKey,
} from "./plugin-settings";

/** Visible label beside the field caption when the value differs from default. */
export const FIELD_EDITED_LABEL = "Edited";

/** Screen-reader hint when a control differs from its schema default (not colour-only). */
export const FIELD_EDITED_ARIA = "Unsaved change";

export type PluginHudCaptionSink = (spec: PluginView, caption: string | null) => void;

let hudCaptionSink: PluginHudCaptionSink | null = null;

export function setPluginHudCaptionSink(sink: PluginHudCaptionSink | null): void {
  hudCaptionSink = sink;
}

function refreshPluginHudCaption(
  spec: PluginView,
  fields: PluginField[],
  values: Record<string, string>,
): void {
  hudCaptionSink?.(spec, buildPluginHudCaption(spec, fields, values));
}

function placeSettingsAnnouncer(host: HTMLElement, announcer: HTMLElement): void {
  if (announcer.parentElement && !host.contains(announcer)) return;
  const parent = host.parentElement;
  if (!parent) {
    if (host.contains(announcer)) announcer.remove();
    return;
  }
  if (announcer.parentElement !== parent) parent.insertBefore(announcer, host);
}

function announceLive(announcer: HTMLElement, msg: string): void {
  announcer.textContent = "";
  queueMicrotask(() => { announcer.textContent = msg; });
}

type PanelCtx = {
  host: HTMLElement;
  spec: PluginView;
  fields: PluginField[];
  values: Record<string, string>;
  storeId: string;
  persist: () => void;
  announce: (msg: string) => void;
  presetSel?: HTMLSelectElement;
  undoBtn?: HTMLButtonElement;
  fieldHosts: Map<string, HTMLElement>;
  onFieldInput?: (key: string, value: string) => void;
};

function syncSectionSummaryEdited(details: HTMLDetailsElement): void {
  const sum = details.querySelector("summary");
  if (!sum) return;
  const dirtyInside = !!details.querySelector(".field-dirty");
  const show = dirtyInside && !details.open;
  if (show) {
    if (!sum.querySelector(".field-edited-cue")) {
      const cue = document.createElement("span");
      cue.className = "field-edited-cue";
      cue.textContent = FIELD_EDITED_LABEL;
      cue.setAttribute("aria-hidden", "true");
      sum.append(cue);
    }
  } else {
    sum.querySelector(".field-edited-cue")?.remove();
  }
}

function syncFieldEditedMarkers(el: HTMLElement, dirty: boolean): void {
  el.classList.toggle("field-dirty", dirty);
  if (dirty) {
    el.setAttribute("aria-description", FIELD_EDITED_ARIA);
    if (!el.querySelector(".field-edited-cue")) {
      const cue = document.createElement("span");
      cue.className = "field-edited-cue";
      cue.textContent = FIELD_EDITED_LABEL;
      cue.setAttribute("aria-hidden", "true");
      const cap = el.querySelector(".cap");
      if (cap?.parentElement === el) cap.before(cue);
      else el.prepend(cue);
    }
  } else {
    el.removeAttribute("aria-description");
    el.querySelector(".field-edited-cue")?.remove();
  }
}

function fieldControlRoot(wrap: HTMLElement): HTMLElement {
  return (wrap.querySelector(".slider, .toggle, .select, .text") as HTMLElement | null) ?? wrap;
}

function focusedFieldKey(host: HTMLElement): string | null {
  const el = document.activeElement;
  if (!el || !host.contains(el)) return null;
  const row = el.closest("[data-field-key]");
  return row?.getAttribute("data-field-key") ?? null;
}

function restoreFieldFocus(host: HTMLElement, key: string | null): void {
  if (!key) return;
  const row = host.querySelector(`[data-field-key="${CSS.escape(key)}"]`);
  const focusable = row?.querySelector<HTMLElement>("input,select,button,textarea");
  focusable?.focus();
}

function restoreToolbarFocus(host: HTMLElement, action: string | null): void {
  if (!action) return;
  const root = host.querySelector<HTMLElement>(`[data-toolbar-action="${CSS.escape(action)}"]`);
  const focusable = root?.matches("button,input,select,textarea")
    ? root
    : root?.querySelector<HTMLElement>("button,input,select,textarea");
  if (focusable && !(focusable as HTMLButtonElement).disabled) {
    focusable.focus();
    return;
  }
  for (const btn of host.querySelectorAll<HTMLButtonElement>(
    ".plugin-settings-toolbar .btn[data-toolbar-action]",
  )) {
    if (!btn.disabled) {
      btn.focus();
      return;
    }
  }
}

function updateDirtyMarkers(ctx: PanelCtx): void {
  for (const [key, wrap] of ctx.fieldHosts) {
    const f = ctx.fields.find((x) => x.key === key);
    if (!f) continue;
    const current = ctx.values[f.key] ?? fieldDefault(f);
    const baseline = fieldBaselineForDirty(ctx.spec, ctx.fields, ctx.values, f.key);
    const dirty = baseline !== undefined && String(current) !== String(baseline);
    syncFieldEditedMarkers(fieldControlRoot(wrap), dirty);
    const details = wrap.closest("details.sec-collapsible");
    if (details instanceof HTMLDetailsElement) syncSectionSummaryEdited(details);
  }
}

/** Preset dropdown value from live config (uses presetField, not __presetBase). */
export function resolvedPresetSelectValue(
  spec: PluginView,
  values: Record<string, string>,
): string {
  const decl = spec.settings;
  const pf = decl?.presetField ?? "preset";
  const presetIds = new Set((decl?.presets ?? []).map((p) => p.id));
  const cur = values[pf] ?? decl?.presets?.[0]?.id ?? CUSTOM_PRESET_ID;
  return presetIds.has(cur) || cur === CUSTOM_PRESET_ID ? cur : CUSTOM_PRESET_ID;
}

function syncPresetPicker(ctx: PanelCtx): void {
  const decl = ctx.spec.settings;
  if (!ctx.presetSel || !decl?.presets?.length) return;
  ctx.presetSel.value = resolvedPresetSelectValue(ctx.spec, ctx.values);
}

function syncUndoButton(ctx: PanelCtx): void {
  if (!ctx.undoBtn) return;
  const empty = undoRingDepth(ctx.storeId) === 0;
  ctx.undoBtn.disabled = empty;
  ctx.undoBtn.setAttribute("aria-disabled", empty ? "true" : "false");
}

function persistValues(ctx: PanelCtx, extraRemove: string[] = []): void {
  markPresetConsistency(ctx.spec, ctx.fields, ctx.values);
  writePluginConfig(ctx.storeId, ctx.values);
  const remove = [...extraRemove];
  if (!(PRESET_BASE_META_KEY in ctx.values)) remove.push(PRESET_BASE_META_KEY);
  if (remove.length) removePluginConfigKeys(ctx.storeId, [...new Set(remove)]);
  refreshPluginHudCaption(ctx.spec, ctx.fields, ctx.values);
  ctx.persist();
  updateDirtyMarkers(ctx);
  syncPresetPicker(ctx);
}

function appendFieldControl(ctx: PanelCtx, row: HTMLElement, f: PluginField): void {
  const values = ctx.values;
  const current = values[f.key] ?? fieldDefault(f);
  const wrap = document.createElement("div");
  wrap.className = "field-wrap";
  wrap.setAttribute("data-field-key", f.key);
  ctx.fieldHosts.set(f.key, wrap);
  if (f.type === "boolean") {
    const t = new Toggle({
      label: f.label,
      title: f.hint,
      checked: current === "1" || current === "true",
      onChange: (on) => {
        values[f.key] = on ? "1" : "0";
        persistValues(ctx);
        updateDirtyMarkers(ctx);
      },
    });
    wrap.append(t.el);
  } else if (f.type === "select" && f.values?.length) {
    const s = new Select({
      caption: f.label,
      title: f.hint,
      options: f.values.map(([value, label]) => ({ value, label })),
      value: current,
      onChange: (v) => {
        values[f.key] = v;
        persistValues(ctx);
        updateDirtyMarkers(ctx);
      },
    });
    wrap.append(s.el);
  } else if (f.type === "number") {
    const min = f.min ?? 0;
    const max = f.max ?? Math.max(min + 1, 100);
    const sl = new Slider({
      label: f.label,
      title: f.hint,
      min,
      max,
      step: f.step ?? 1,
      value: Number(current),
      onInput: (v) => {
        values[f.key] = String(v);
        ctx.onFieldInput?.(f.key, String(v));
        updateDirtyMarkers(ctx);
      },
    });
    sl.el.querySelector("input")?.addEventListener("change", () => {
      persistValues(ctx);
      updateDirtyMarkers(ctx);
    });
    wrap.append(sl.el);
  } else {
    const tf = new TextField({
      caption: f.label,
      title: f.hint,
      placeholder: f.default !== undefined ? String(f.default) : undefined,
      value: current,
      onInput: (v) => {
        values[f.key] = v;
        persistValues(ctx);
        updateDirtyMarkers(ctx);
      },
    });
    wrap.append(tf.el);
  }
  updateDirtyMarkers(ctx);
  row.append(wrap);
}

function viewLayerForScopeNote(root: HTMLElement): HTMLElement {
  return root.querySelector('.plugin-layer[data-layer="view"]') as HTMLElement ?? root;
}

function mountPackScopeNote(host: HTMLElement, spec: PluginView, wall?: PackWallScope): void {
  const text = packScopeNoteText(spec, wall);
  if (!text) return;
  const layer = viewLayerForScopeNote(host);
  const existing = layer.querySelector(".plugin-pack-scope-note");
  if (existing instanceof HTMLElement) {
    if (existing.textContent !== text) existing.textContent = text;
    return;
  }
  const note = document.createElement("div");
  note.className = "sec-hint plugin-pack-scope-note";
  note.textContent = text;
  layer.append(note);
}

export function syncPackScopeNote(root: HTMLElement, spec: PluginView, wall?: PackWallScope): void {
  const text = packScopeNoteText(spec, wall);
  const existing = root.querySelector(".plugin-pack-scope-note");
  if (!text) {
    existing?.remove();
    return;
  }
  if (existing instanceof HTMLElement) {
    if (existing.textContent !== text) existing.textContent = text;
    return;
  }
  mountPackScopeNote(viewLayerForScopeNote(root), spec, wall);
}

function mountSettingsToolbar(ctx: PanelCtx, host: HTMLElement): void {
  const decl = ctx.spec.settings;
  if (!showSettingsToolbar(ctx.spec, ctx.fields)) return;
  const row = document.createElement("div");
  row.className = "sec plugin-settings-toolbar";
  row.setAttribute("aria-label", "Preset tools");
  const controls = document.createElement("div");
  controls.className = "sec-controls plugin-settings-toolbar-row";

  const pf = decl?.presetField ?? "preset";
  const presetField = ctx.fields.find((f) => f.key === pf);
  if (decl?.presets?.length) {
    const presetIds = new Set(decl.presets.map((p) => p.id));
    const cur = ctx.values[pf] ?? decl.presets[0]?.id ?? CUSTOM_PRESET_ID;
    const wrap = document.createElement("label");
    wrap.className = "field plugin-preset-field";
    const cap = document.createElement("span");
    cap.className = "cap";
    cap.textContent = presetField?.label ?? "preset";
    const presetSel = document.createElement("select");
    presetSel.className = "plugin-preset-select";
    presetSel.title = presetField?.hint ?? "Named starting points";
    presetSel.setAttribute("aria-label", presetField?.label ?? "preset");
    presetSel.setAttribute("data-toolbar-action", "preset");
    for (const p of decl.presets) {
      const opt = document.createElement("option");
      opt.value = p.id;
      opt.textContent = p.label;
      presetSel.append(opt);
    }
    const customOpt = document.createElement("option");
    customOpt.value = CUSTOM_PRESET_ID;
    customOpt.textContent = "Custom";
    presetSel.append(customOpt);
    presetSel.value = presetIds.has(cur) || cur === CUSTOM_PRESET_ID ? cur : CUSTOM_PRESET_ID;
    let lastPresetPick = presetSel.value;
    const applyPresetSelection = () => {
      const v = presetSel.value;
      if (v === lastPresetPick) return;
      lastPresetPick = v;
      if (v === CUSTOM_PRESET_ID) {
        const prev = ctx.values[pf] && ctx.values[pf] !== CUSTOM_PRESET_ID
          ? ctx.values[pf] : ctx.values[PRESET_BASE_META_KEY];
        if (prev && prev !== CUSTOM_PRESET_ID) ctx.values[PRESET_BASE_META_KEY] = prev;
        ctx.values[pf] = CUSTOM_PRESET_ID;
        persistValues(ctx);
        return;
      }
      pushUndoSnapshot(ctx.storeId, { ...ctx.values });
      applyPresetToValues(ctx.spec, ctx.fields, ctx.values, v);
      delete ctx.values[PRESET_BASE_META_KEY];
      const label = presetById(ctx.spec.settings, v)?.label ?? v;
      persistValues(ctx);
      remountPanel(ctx, { toolbar: "preset" });
      ctx.announce(`Preset ${label}`);
    };
    presetSel.addEventListener("change", applyPresetSelection);
    wrap.append(cap, presetSel);
    ctx.presetSel = presetSel;
    controls.append(wrap);
  }

  const mkBtn = (action: string, label: string, title: string, onClick: () => void) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "btn";
    b.textContent = label;
    b.title = title;
    b.setAttribute("data-toolbar-action", action);
    b.addEventListener("click", onClick);
    return b;
  };

  const undoBtn = mkBtn("undo", "Undo", "Undo last bulk change", () => {
    const snap = popUndoSnapshot(ctx.storeId);
    if (!snap) return;
    for (const k of Object.keys(ctx.values)) {
      if (!(k in snap)) delete ctx.values[k];
    }
    for (const k of Object.keys(snap)) {
      ctx.values[k] = snap[k]!;
    }
    persistValues(ctx);
    syncUndoButton(ctx);
    remountPanel(ctx, { toolbar: "undo" });
    ctx.announce("Undone");
  });
  ctx.undoBtn = undoBtn;

  controls.append(
    mkBtn("randomise", "Randomise", "Randomise fields (respects randomRange and randomise:false)", () => {
      pushUndoSnapshot(ctx.storeId, { ...ctx.values });
      randomiseDeclaredConfig(ctx.spec, ctx.fields, ctx.values, Math.random);
      persistValues(ctx);
      syncUndoButton(ctx);
      remountPanel(ctx, { toolbar: "randomise" });
      ctx.announce("Randomised");
    }),
    undoBtn,
    mkBtn("reset", "Reset to defaults", "Reset to pack defaults (instance preset or first preset; text fields unchanged)", () => {
      pushUndoSnapshot(ctx.storeId, { ...ctx.values });
      resetDeclaredConfig(ctx.spec, ctx.fields, ctx.values);
      delete ctx.values[PRESET_BASE_META_KEY];
      persistValues(ctx);
      syncUndoButton(ctx);
      remountPanel(ctx, { toolbar: "reset" });
      ctx.announce("Reset to defaults");
    }),
  );
  row.append(controls);
  host.append(row);
  syncUndoButton(ctx);
}

function mountSectionedFields(ctx: PanelCtx, host: HTMLElement, compact: PluginField[]): void {
  const sectionDecl = ctx.spec.settings?.sections ?? [];
  const titles = orderedSectionTitles(ctx.spec, compact);
  const pf = ctx.spec.settings?.presetField;
  const bySection = new Map<string, PluginField[]>();
  for (const f of compact) {
    if (pf && f.key === pf && ctx.spec.settings?.presets?.length) continue;
    const t = f.section ?? "";
    if (!bySection.has(t)) bySection.set(t, []);
    bySection.get(t)!.push(f);
  }
  titles.forEach((title, index) => {
    const sectionFields = bySection.get(title);
    if (!sectionFields?.length) return;
    const open = hasDeclaredSettings(ctx.spec)
      ? sectionOpenState(ctx.storeId, title, sectionDecl, index)
      : true;
    const container = title
      ? document.createElement("details")
      : document.createElement("div");
    if (container instanceof HTMLDetailsElement) {
      container.className = "sec sec-collapsible";
      container.open = open;
      const sum = document.createElement("summary");
      sum.className = "sec-title";
      sum.textContent = title;
      container.append(sum);
      container.addEventListener("toggle", () => {
        rememberSectionOpen(ctx.storeId, title, container.open);
        syncSectionSummaryEdited(container);
      });
    } else {
      container.className = "sec";
    }
    const row = document.createElement("div");
    row.className = "sec-controls";
    for (const f of sectionFields) appendFieldControl(ctx, row, f);
    container.append(row);
    if (container instanceof HTMLDetailsElement) syncSectionSummaryEdited(container);
    host.append(container);
  });
}

type PanelMount = {
  host: HTMLElement;
  spec: PluginView;
  fields: PluginField[];
  onPersist: (id: string, values: Record<string, string>) => void;
  opts?: {
    skipEmpty?: boolean;
    devices?: SdmDevice[];
    wallScope?: PackWallScope;
    draftValues?: Record<string, string>;
    onFieldInput?: (key: string, value: string) => void;
  };
  announcer: HTMLElement;
  values?: Record<string, string>;
};

const panelMounts = new WeakMap<HTMLElement, PanelMount>();

export function pluginSettingsPanelValues(host: HTMLElement): Record<string, string> | undefined {
  return panelMounts.get(host)?.values;
}

function remountPanel(ctx: PanelCtx, restore?: { toolbar?: string; field?: string }): void {
  const mount = panelMounts.get(ctx.host);
  if (!mount) return;
  const fieldKey = restore?.field ?? focusedFieldKey(ctx.host);
  const { announcer } = mount;
  const seed = { ...ctx.values };
  mount.host.replaceChildren();
  fillPluginFields(mount.host, mount.spec, mount.fields, mount.onPersist, mount.opts, announcer, seed);
  if (restore?.toolbar) restoreToolbarFocus(mount.host, restore.toolbar);
  else restoreFieldFocus(mount.host, fieldKey);
}

export function fillPluginFields(
  host: HTMLElement,
  spec: PluginView,
  fields: PluginField[],
  onPersist: (id: string, values: Record<string, string>) => void,
  opts?: {
    skipEmpty?: boolean;
    devices?: SdmDevice[];
    wallScope?: PackWallScope;
    draftValues?: Record<string, string>;
    onFieldInput?: (key: string, value: string) => void;
  },
  existingAnnouncer?: HTMLElement,
  seedValues?: Record<string, string>,
): void {
  const announcer = existingAnnouncer ?? document.createElement("div");
  if (!existingAnnouncer) {
    announcer.className = "sr-only plugin-settings-announcer";
    announcer.setAttribute("aria-live", "polite");
    announcer.setAttribute("aria-atomic", "true");
  }
  placeSettingsAnnouncer(host, announcer);
  panelMounts.set(host, { host, spec, fields, onPersist, opts, announcer });
  const values = {
    ...(seedValues ? { ...seedValues } : loadPluginConfig(spec, fields)),
    ...opts?.draftValues,
  };
  if (hasDeclaredSettings(spec)) markPresetConsistency(spec, fields, values);
  const head = document.createElement("div");
  head.className = "sec";
  const title = document.createElement("div");
  title.className = "sec-title";
  title.textContent = specCaption(spec);
  const meta = document.createElement("div");
  meta.className = "sec-hint";
  meta.textContent = `${spec.id} · v${spec.version} · ${spec.engine ?? "yaml"}${spec.base ? ` / ${spec.base}` : ""}${spec.hint ? `. ${spec.hint}` : ""}`;
  head.append(title, meta);
  let knobs = fields;
  if (spec.id === "nest-cams") {
    knobs = mountNestCamFields(host, spec, fields, values, opts?.devices ?? [], onPersist);
  } else {
    host.append(head);
  }
  if (!knobs.length) {
    if (!opts?.skipEmpty && spec.id !== "nest-cams") {
      const empty = document.createElement("div");
      empty.className = "sec";
      empty.innerHTML = `<div class="sec-hint">This plugin has no extra settings.</div>`;
      host.append(empty);
    }
    return;
  }
  const storeId = configStoreId(spec);
  const mount = panelMounts.get(host);
  if (mount) mount.values = values;
  const ctx: PanelCtx = {
    host,
    spec,
    fields,
    values,
    storeId,
    fieldHosts: new Map(),
    announce: (msg) => { announceLive(announcer, msg); },
    persist: () => {
      onPersist(storeId, packConfigValues(values));
    },
    onFieldInput: opts?.onFieldInput,
  };
  const compact: PluginField[] = [];
  const notes: PluginField[] = [];
  for (const f of knobs) {
    if (f.type === "textarea") notes.push(f);
    else compact.push(f);
  }
  mountPackScopeNote(host, spec, opts?.wallScope);
  if (showSettingsToolbar(spec, fields)) {
    mountSettingsToolbar(ctx, host);
    mountSectionedFields(ctx, host, compact);
  } else if (hasDeclaredSettings(spec) || compact.some((f) => f.section)) {
    mountSectionedFields(ctx, host, compact);
  } else if (compact.length) {
    const sec = document.createElement("div");
    sec.className = "sec";
    const row = document.createElement("div");
    row.className = "sec-controls";
    for (const f of compact) appendFieldControl(ctx, row, f);
    sec.append(row);
    host.append(sec);
  }
  for (const f of notes) {
    const current = values[f.key] ?? fieldDefault(f);
    const wrap = document.createElement("div");
    wrap.className = "sec view-prompt";
    const cap = document.createElement("label");
    cap.className = "cap";
    cap.textContent = f.label;
    if (f.hint) {
      wrap.title = f.hint;
      cap.title = f.hint;
    }
    const ta = document.createElement("textarea");
    ta.rows = 3;
    ta.spellcheck = false;
    ta.setAttribute("autocomplete", "off");
    ta.setAttribute("aria-label", f.label);
    if (f.hint) ta.placeholder = f.hint;
    ta.value = current;
    ta.addEventListener("input", () => { values[f.key] = ta.value; persistValues(ctx); });
    wrap.append(cap, ta);
    host.append(wrap);
  }
  refreshPluginHudCaption(spec, fields, values);
  updateDirtyMarkers(ctx);
}

/** Modal: the operator wrote this plugin, or they examined the source (AI IDE suggested). */
export function askPluginReview(
  spec: PluginView,
  opts?: { signal?: AbortSignal },
): Promise<"reviewed" | "authored" | null> {
  return new Promise((resolve) => {
    const bits: string[] = [];
    if (spec.runtime === "typescript" || spec.has_frontend) bits.push("sandboxed TypeScript");
    if (spec.service) bits.push("a Python module loaded into the monitor process");
    if (spec.has_sky_shader || spec.shader_sha256) bits.push("a custom GLSL sky shader");
    const what = bits.join(" and ") || "executable code";

    const modal = document.createElement("div");
    modal.className = "modal ask";
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    const back = document.createElement("div");
    back.className = "backdrop";
    const sheet = document.createElement("div");
    sheet.className = "sheet";
    const head = document.createElement("div");
    head.className = "mhead";
    const h = document.createElement("strong");
    h.textContent = `Review “${spec.name}” before activating`;
    head.appendChild(h);
    const body = document.createElement("div");
    body.className = "ask-body";
    const p1 = document.createElement("p");
    p1.textContent = `This plugin ships ${what}. That is not the same as a YAML look overlay — it can change how the monitor or graph behaves.`;
    const p2 = document.createElement("p");
    p2.textContent = "If you did not write it, examine the source for security issues before continuing. Open the plugin folder in an AI IDE (for example Cursor) and ask it to review the TypeScript, any service/*.py files, and sky/fragment.glsl.";
    const p3 = document.createElement("p");
    p3.className = "muted";
    p3.textContent = spec.file ? `Source: ${spec.file}` : `id ${spec.id} · v${spec.version}`;
    body.append(p1, p2, p3);
    const row = document.createElement("div");
    row.className = "ask-actions";
    const finish = (kind: "reviewed" | "authored" | null) => {
      document.body.classList.remove("modal-open");
      modal.remove();
      document.removeEventListener("keydown", onKey, true);
      opts?.signal?.removeEventListener("abort", onAbort);
      resolve(kind);
    };
    const onAbort = () => finish(null);
    if (opts?.signal?.aborted) {
      finish(null);
      return;
    }
    opts?.signal?.addEventListener("abort", onAbort, { once: true });
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "btn";
    cancel.textContent = "Not now";
    cancel.addEventListener("click", () => finish(null));
    const wrote = document.createElement("button");
    wrote.type = "button";
    wrote.className = "btn";
    wrote.textContent = "I wrote this";
    wrote.addEventListener("click", () => finish("authored"));
    const reviewed = document.createElement("button");
    reviewed.type = "button";
    reviewed.className = "btn primary";
    reviewed.textContent = "I examined the source";
    reviewed.addEventListener("click", () => finish("reviewed"));
    row.append(cancel, wrote, reviewed);
    sheet.append(head, body, row);
    modal.append(back, sheet);
    back.addEventListener("click", () => finish(null));
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); finish(null); }
      if (e.key === "Enter" && !e.repeat && document.activeElement === cancel) {
        e.preventDefault();
        finish(null);
      }
    };
    document.addEventListener("keydown", onKey, true);
    document.body.classList.add("modal-open");
    document.body.appendChild(modal);
    cancel.focus();
  });
}
