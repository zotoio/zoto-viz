import {
  configStoreId,
  fieldDefault,
  loadPluginConfig,
  removePluginConfigKeys,
  specCaption,
  writePluginConfig,
  type PluginView,
} from "./plugin";
import { configStoredPerTile } from "./instances";
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
  sectionOpenState,
  showSettingsToolbar,
  undoRingDepth,
} from "./plugin-settings";

export type PluginHudCaptionSink = (spec: PluginView, caption: string | null) => void;

let hudCaptionSink: PluginHudCaptionSink | null = null;

export function setPluginHudCaptionSink(sink: PluginHudCaptionSink | null): void {
  hudCaptionSink = sink;
}

export function refreshPluginHudCaption(
  spec: PluginView,
  fields: PluginField[],
  values: Record<string, string>,
): void {
  hudCaptionSink?.(spec, buildPluginHudCaption(spec, fields, values));
}

type PanelCtx = {
  host: HTMLElement;
  spec: PluginView;
  fields: PluginField[];
  values: Record<string, string>;
  storeId: string;
  persist: () => void;
  announce: (msg: string) => void;
  presetSel?: Select;
  undoBtn?: HTMLButtonElement;
  fieldHosts: Map<string, HTMLElement>;
};

function focusedFieldKey(host: HTMLElement): string | null {
  const el = document.activeElement;
  if (!el || !host.contains(el)) return null;
  const row = el.closest("[data-field-key]");
  return row?.getAttribute("data-field-key") ?? null;
}

function restoreFieldFocus(host: HTMLElement, key: string | null): void {
  if (!key) return;
  const row = host.querySelector(`[data-field-key="${key}"]`);
  const focusable = row?.querySelector<HTMLElement>("input,select,button,textarea");
  focusable?.focus();
}

function updateDirtyMarkers(ctx: PanelCtx): void {
  for (const [key, wrap] of ctx.fieldHosts) {
    const f = ctx.fields.find((x) => x.key === key);
    if (!f) continue;
    const current = ctx.values[f.key] ?? fieldDefault(f);
    const baseline = fieldBaselineForDirty(ctx.spec, ctx.fields, ctx.values, f.key);
    const dirty = baseline !== undefined && String(current) !== String(baseline);
    wrap.classList.toggle("field-dirty", dirty);
  }
}

function syncPresetPicker(ctx: PanelCtx): void {
  const decl = ctx.spec.settings;
  if (!ctx.presetSel || !decl?.presets?.length) return;
  const pf = decl.presetField ?? "preset";
  const presetIds = new Set(decl.presets.map((p) => p.id));
  const cur = ctx.values[pf] ?? decl.presets[0]?.id ?? CUSTOM_PRESET_ID;
  ctx.presetSel.value = presetIds.has(cur) || cur === CUSTOM_PRESET_ID ? cur : CUSTOM_PRESET_ID;
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
  ctx.persist();
  updateDirtyMarkers(ctx);
  syncPresetPicker(ctx);
  refreshPluginHudCaption(ctx.spec, ctx.fields, ctx.values);
}

function appendFieldControl(ctx: PanelCtx, row: HTMLElement, f: PluginField): void {
  const values = ctx.values;
  const current = values[f.key] ?? fieldDefault(f);
  const baseline = fieldBaselineForDirty(ctx.spec, ctx.fields, values, f.key);
  const dirty = baseline !== undefined && String(current) !== String(baseline);
  const wrap = document.createElement("div");
  wrap.className = "field-wrap";
  wrap.setAttribute("data-field-key", f.key);
  if (dirty) wrap.classList.add("field-dirty");
  ctx.fieldHosts.set(f.key, wrap);
  const pf = ctx.spec.settings?.presetField;
  if (f.type === "boolean") {
    const t = new Toggle({
      label: f.label,
      title: f.hint,
      checked: current === "1" || current === "true",
      onChange: (on) => { values[f.key] = on ? "1" : "0"; persistValues(ctx); },
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
        if (pf && f.key === pf && v !== CUSTOM_PRESET_ID && ctx.spec.settings?.presets?.some((p) => p.id === v)) {
          pushUndoSnapshot(ctx.storeId, { ...values });
          applyPresetToValues(ctx.spec, ctx.fields, values, v);
          delete values[PRESET_BASE_META_KEY];
          persistValues(ctx);
          ctx.announce(`Preset ${v}`);
          remountPanel(ctx);
          return;
        }
        if (pf && f.key === pf && v === CUSTOM_PRESET_ID) {
          const prev = values[pf] && values[pf] !== CUSTOM_PRESET_ID ? values[pf] : values[PRESET_BASE_META_KEY];
          if (prev && prev !== CUSTOM_PRESET_ID) values[PRESET_BASE_META_KEY] = prev;
          values[pf] = CUSTOM_PRESET_ID;
        }
        persistValues(ctx);
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
      onInput: (v) => { values[f.key] = String(v); persistValues(ctx); },
    });
    wrap.append(sl.el);
  } else {
    const tf = new TextField({
      caption: f.label,
      title: f.hint,
      placeholder: f.default !== undefined ? String(f.default) : undefined,
      value: current,
      onInput: (v) => { values[f.key] = v; persistValues(ctx); },
    });
    wrap.append(tf.el);
  }
  row.append(wrap);
}

function mountPackScopeNote(host: HTMLElement, spec: PluginView): void {
  if (configStoredPerTile(spec)) return;
  const note = document.createElement("div");
  note.className = "sec-hint plugin-pack-scope-note";
  note.textContent = `Applies to all ${spec.name} tiles`;
  host.append(note);
}

function mountSettingsToolbar(ctx: PanelCtx, host: HTMLElement): void {
  const decl = ctx.spec.settings;
  if (!showSettingsToolbar(ctx.spec, ctx.fields)) return;
  const row = document.createElement("div");
  row.className = "sec plugin-settings-toolbar";
  row.setAttribute("aria-label", "Preset tools");
  const controls = document.createElement("div");
  controls.className = "sec-controls plugin-settings-toolbar-row";

  const live = document.createElement("div");
  live.className = "sr-only";
  live.setAttribute("aria-live", "polite");
  live.setAttribute("aria-atomic", "true");
  ctx.announce = (msg) => { live.textContent = msg; };

  const pf = decl?.presetField ?? "preset";
  const presetField = ctx.fields.find((f) => f.key === pf);
  if (decl?.presets?.length) {
    const presetIds = new Set(decl.presets.map((p) => p.id));
    const options = [
      ...decl.presets.map((p) => ({ value: p.id, label: p.label })),
      { value: CUSTOM_PRESET_ID, label: "Custom" },
    ];
    const cur = ctx.values[pf] ?? decl.presets[0]?.id ?? CUSTOM_PRESET_ID;
    const presetSel = new Select({
      caption: presetField?.label ?? "preset",
      title: presetField?.hint ?? "Named starting points",
      options,
      value: presetIds.has(cur) || cur === CUSTOM_PRESET_ID ? cur : CUSTOM_PRESET_ID,
      onChange: (v) => {
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
        persistValues(ctx);
        ctx.announce(`Preset ${v}`);
        remountPanel(ctx);
      },
    });
    ctx.presetSel = presetSel;
    controls.append(presetSel.el);
  }

  const mkBtn = (label: string, title: string, onClick: () => void) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "btn";
    b.textContent = label;
    b.title = title;
    b.addEventListener("click", onClick);
    return b;
  };

  const undoBtn = mkBtn("Undo", "Undo last bulk change", () => {
    const snap = popUndoSnapshot(ctx.storeId);
    if (!snap) return;
    for (const k of Object.keys(ctx.values)) {
      if (k === PRESET_BASE_META_KEY || k.startsWith("__")) continue;
      if (!(k in snap)) delete ctx.values[k];
    }
    Object.assign(ctx.values, snap);
    persistValues(ctx);
    syncUndoButton(ctx);
    ctx.announce("Undone");
    remountPanel(ctx);
  });
  ctx.undoBtn = undoBtn;

  controls.append(
    mkBtn("Randomise", "Randomise fields (respects randomRange and randomise:false)", () => {
      pushUndoSnapshot(ctx.storeId, { ...ctx.values });
      randomiseDeclaredConfig(ctx.spec, ctx.fields, ctx.values, Math.random);
      persistValues(ctx);
      syncUndoButton(ctx);
      ctx.announce("Randomised");
      remountPanel(ctx);
    }),
    undoBtn,
    mkBtn("Reset", "Reset to active preset or defaults", () => {
      pushUndoSnapshot(ctx.storeId, { ...ctx.values });
      resetDeclaredConfig(ctx.spec, ctx.fields, ctx.values);
      delete ctx.values[PRESET_BASE_META_KEY];
      persistValues(ctx);
      syncUndoButton(ctx);
      ctx.announce("Reset");
      remountPanel(ctx);
    }),
  );
  row.append(live, controls);
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
    const open = sectionOpenState(ctx.storeId, title, sectionDecl, index);
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
      });
    } else {
      container.className = "sec";
    }
    const row = document.createElement("div");
    row.className = "sec-controls";
    for (const f of sectionFields) appendFieldControl(ctx, row, f);
    container.append(row);
    host.append(container);
  });
}

type PanelMount = {
  host: HTMLElement;
  spec: PluginView;
  fields: PluginField[];
  onPersist: (id: string, values: Record<string, string>) => void;
  opts?: { skipEmpty?: boolean; devices?: SdmDevice[] };
};

const panelMounts = new WeakMap<HTMLElement, PanelMount>();

function remountPanel(ctx: PanelCtx): void {
  const mount = panelMounts.get(ctx.host);
  if (!mount) return;
  const focusKey = focusedFieldKey(ctx.host);
  mount.host.replaceChildren();
  fillPluginFields(mount.host, mount.spec, mount.fields, mount.onPersist, mount.opts);
  restoreFieldFocus(mount.host, focusKey);
}

export function fillPluginFields(
  host: HTMLElement,
  spec: PluginView,
  fields: PluginField[],
  onPersist: (id: string, values: Record<string, string>) => void,
  opts?: { skipEmpty?: boolean; devices?: SdmDevice[] },
): void {
  panelMounts.set(host, { host, spec, fields, onPersist, opts });
  const values = loadPluginConfig(spec, fields);
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
  const ctx: PanelCtx = {
    host,
    spec,
    fields,
    values,
    storeId,
    fieldHosts: new Map(),
    announce: () => {},
    persist: () => {
      onPersist(storeId, packConfigValues(values));
    },
  };
  const compact: PluginField[] = [];
  const notes: PluginField[] = [];
  for (const f of knobs) {
    if (f.type === "textarea") notes.push(f);
    else compact.push(f);
  }
  if (showSettingsToolbar(spec, fields)) {
    mountPackScopeNote(host, spec);
    mountSettingsToolbar(ctx, host);
    mountSectionedFields(ctx, host, compact);
  } else if (hasDeclaredSettings(spec)) {
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
}

/** Modal: the operator wrote this plugin, or they examined the source (AI IDE suggested). */
export function askPluginReview(spec: PluginView): Promise<"reviewed" | "authored" | null> {
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
      resolve(kind);
    };
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
    };
    document.addEventListener("keydown", onKey, true);
    document.body.classList.add("modal-open");
    document.body.appendChild(modal);
    reviewed.focus();
  });
}
