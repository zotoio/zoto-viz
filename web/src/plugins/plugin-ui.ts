import { WORK_BUDGET_LIMITED_NOTE } from "../../../plugins/sdk/work-budget-limited-note";
import { configStoreId, fieldDefault, loadPluginConfig, specCaption, writePluginConfig, type PluginView } from "./plugin";

/** Pack info `.sec-hint` line (id / version / engine + optional workBudget note). */
export function pluginPackMetaLine(spec: PluginView): string {
  const base = `${spec.id} · v${spec.version} · ${spec.engine ?? "yaml"}${spec.base ? ` / ${spec.base}` : ""}${spec.hint ? `. ${spec.hint}` : ""}`;
  if (spec.workBudgetLimited) {
    return `${base}. ${spec.workBudgetLimited}`;
  }
  return base;
}
import type { PluginField } from "../core/modes";
import { Select, Slider, TextField, Toggle } from "../ui/ui";
import { mountNestCamFields } from "./nest-cams-ui";
import type { SdmDevice } from "./nest-cams-look";

/** Visible label beside the field caption when the value differs from default. */
export const FIELD_EDITED_LABEL = "Edited";

/** Screen-reader hint when a control differs from its schema default (not colour-only). */
export const FIELD_EDITED_ARIA = "Unsaved change";

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

function appendFieldControl(
  row: HTMLElement,
  f: PluginField,
  values: Record<string, string>,
  persist: () => void,
  onDirtyChange?: () => void,
): void {
  const current = values[f.key] ?? fieldDefault(f);
  const syncDirty = (el: HTMLElement) => {
    const cur = values[f.key] ?? fieldDefault(f);
    syncFieldEditedMarkers(el, String(cur) !== String(fieldDefault(f)));
    onDirtyChange?.();
  };
  const wrap = (el: HTMLElement) => {
    syncDirty(el);
    el.setAttribute("data-field-key", f.key);
    row.append(el);
  };
  if (f.type === "boolean") {
    const t = new Toggle({
      label: f.label,
      title: f.hint,
      checked: current === "1" || current === "true",
      onChange: (on) => {
        values[f.key] = on ? "1" : "0";
        syncDirty(t.el);
        persist();
      },
    });
    wrap(t.el);
  } else if (f.type === "select" && f.values?.length) {
    const s = new Select({
      caption: f.label,
      title: f.hint,
      options: f.values.map(([value, label]) => ({ value, label })),
      value: current,
      onChange: (v) => {
        values[f.key] = v;
        syncDirty(s.el);
        persist();
      },
    });
    wrap(s.el);
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
        syncDirty(sl.el);
        persist();
      },
    });
    wrap(sl.el);
  } else {
    const tf = new TextField({
      caption: f.label,
      title: f.hint,
      placeholder: f.default !== undefined ? String(f.default) : undefined,
      value: current,
      onInput: (v) => {
        values[f.key] = v;
        syncDirty(tf.el);
        persist();
      },
    });
    wrap(tf.el);
  }
}

export function fillPluginFields(
  host: HTMLElement,
  spec: PluginView,
  fields: PluginField[],
  onPersist: (id: string, values: Record<string, string>) => void,
  opts?: { skipEmpty?: boolean; devices?: SdmDevice[] },
): void {
  const values = loadPluginConfig(spec, fields);
  const head = document.createElement("div");
  head.className = "sec";
  const title = document.createElement("div");
  title.className = "sec-title";
  title.textContent = specCaption(spec);
  const meta = document.createElement("div");
  meta.className = "sec-hint";
  meta.textContent = pluginPackMetaLine(spec);
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
  const persist = () => {
    writePluginConfig(configStoreId(spec), values);
    onPersist(configStoreId(spec), values);
  };
  const compact: PluginField[] = [];
  const notes: PluginField[] = [];
  for (const f of knobs) {
    if (f.type === "textarea") notes.push(f);
    else compact.push(f);
  }
  const hasSections = compact.some((f) => f.section);
  if (compact.length && hasSections) {
    const groups = new Map<string, PluginField[]>();
    for (const f of compact) {
      const s = f.section ?? "";
      if (!groups.has(s)) groups.set(s, []);
      groups.get(s)!.push(f);
    }
    for (const [section, sectionFields] of groups) {
      const container = section
        ? document.createElement("details")
        : document.createElement("div");
      if (container instanceof HTMLDetailsElement) {
        container.className = "sec sec-collapsible";
        container.open = true;
        const sum = document.createElement("summary");
        sum.className = "sec-title";
        sum.textContent = section;
        container.append(sum);
        container.addEventListener("toggle", () => syncSectionSummaryEdited(container));
      } else {
        container.className = "sec";
      }
      const row = document.createElement("div");
      row.className = "sec-controls";
      const sectionDetails = container instanceof HTMLDetailsElement ? container : undefined;
      const onSectionDirty = sectionDetails
        ? () => syncSectionSummaryEdited(sectionDetails)
        : undefined;
      for (const f of sectionFields) appendFieldControl(row, f, values, persist, onSectionDirty);
      container.append(row);
      if (sectionDetails) syncSectionSummaryEdited(sectionDetails);
      host.append(container);
    }
  } else if (compact.length) {
    const sec = document.createElement("div");
    sec.className = "sec";
    const row = document.createElement("div");
    row.className = "sec-controls";
    for (const f of compact) appendFieldControl(row, f, values, persist);
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
    ta.addEventListener("input", () => { values[f.key] = ta.value; persist(); });
    wrap.append(cap, ta);
    host.append(wrap);
  }
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
