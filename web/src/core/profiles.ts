import { DEFAULT_FEED, type FeedConfig } from "../ui/feed";
import { allModes, defaultOpts } from "./modes";
import { DEFAULT_DREAM, type DreamAnim } from "../graph/scene";
import { DEFAULT_THEME } from "./themes";
import { Toggle } from "../ui/ui";
import { apiFetch } from "./http";

/** Shipped profile id. Always present, never overwritten from the UI. */
export const SHIPPED_ID = "netviz";
export const USER_ID = "user";

export interface ProfileMeta {
  id: string;
  label: string;
  shipped: boolean;
}

export interface ProfileList {
  default: string;
  fresh: boolean;
  file: string;
  profiles: ProfileMeta[];
}

export interface ProfileSettings {
  theme: string;
  dream: boolean;
  mode: string;
  modeOptions: Record<string, Record<string, string>>;
  show: { lan: boolean; internet: boolean; multicast: boolean; offline: boolean; labels: boolean };
  merge: boolean;
  redact: boolean;
  filters: { allowNames: string; blockNames: string; allowNets: string; blockNets: string };
  anim: DreamAnim;
  feed: FeedConfig;
  arcade: Record<string, string>;
  /** where the chrome sits: top header, or a wide left/right bar (the other side holds the inspect panel) */
  chrome: "top" | "left" | "right";
  /** per-plugin cog values, keyed by YAML plugin id */
  plugins: Record<string, Record<string, string>>;
  /** write this writable profile as settings change (ignored for shipped netviz) */
  autosave: boolean;
}

export interface ProfileHost {
  collect(): ProfileSettings;
  apply(s: ProfileSettings): void;
}

let hush = 0;

/** Run a settings write without marking the loaded profile dirty. */
export function quiet<T>(fn: () => T): T {
  hush++;
  try { return fn(); } finally { hush--; }
}

export function shippedSettings(): ProfileSettings {
  return {
    theme: DEFAULT_THEME.id,
    dream: false,
    mode: allModes()[0]!.id,
    modeOptions: Object.fromEntries(allModes().map((m) => [m.id, defaultOpts(m)])),
    show: { lan: true, internet: true, multicast: true, offline: true, labels: true },
    merge: false,
    redact: false,
    filters: { allowNames: "", blockNames: "", allowNets: "", blockNets: "" },
    anim: { ...DEFAULT_DREAM },
    feed: { ...DEFAULT_FEED },
    arcade: {},
    chrome: "top",
    plugins: {},
    autosave: false,
  };
}

export function normalizeSettings(raw: unknown): ProfileSettings {
  const d = shippedSettings();
  const s = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const show = s.show && typeof s.show === "object" ? s.show as Record<string, unknown> : {};
  const filters = s.filters && typeof s.filters === "object" ? s.filters as Record<string, unknown> : {};
  const anim = s.anim && typeof s.anim === "object" ? s.anim as DreamAnim : d.anim;
  const feed = s.feed && typeof s.feed === "object" ? s.feed as FeedConfig : d.feed;
  const modeOptions = s.modeOptions && typeof s.modeOptions === "object"
    ? s.modeOptions as Record<string, Record<string, string>>
    : d.modeOptions;
  const arcade = s.arcade && typeof s.arcade === "object" ? s.arcade as Record<string, string> : {};
  const plugins = s.plugins && typeof s.plugins === "object" ? s.plugins as Record<string, Record<string, string>> : {};
  return {
    theme: typeof s.theme === "string" ? s.theme : d.theme,
    dream: bool(s.dream, d.dream),
    mode: typeof s.mode === "string" ? s.mode : d.mode,
    modeOptions: { ...d.modeOptions, ...modeOptions },
    show: {
      lan: bool(show.lan, d.show.lan),
      internet: bool(show.internet, d.show.internet),
      multicast: bool(show.multicast, d.show.multicast),
      offline: bool(show.offline, d.show.offline),
      labels: bool(show.labels, d.show.labels),
    },
    merge: bool(s.merge, d.merge),
    redact: bool(s.redact, d.redact),
    filters: {
      allowNames: str(filters.allowNames),
      blockNames: str(filters.blockNames),
      allowNets: str(filters.allowNets),
      blockNets: str(filters.blockNets),
    },
    anim: { ...d.anim, ...anim },
    feed: { ...d.feed, ...feed },
    arcade: { ...arcade },
    chrome: s.chrome === "left" || s.chrome === "right" ? s.chrome : d.chrome,
    plugins: { ...plugins },
    autosave: bool(s.autosave, d.autosave),
  };
}

function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === "boolean" ? v : fallback;
}
function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

const ID_RE = /^[a-z][a-z0-9_-]{0,31}$/;
const AUTOSAVE_DEBOUNCE_MS = 450;

export function suggestId(taken: string[]): string {
  if (!taken.includes(USER_ID)) return USER_ID;
  for (let i = 2; i < 100; i++) {
    const id = `${USER_ID}-${i}`;
    if (!taken.includes(id)) return id;
  }
  return `user-${Date.now().toString(36)}`;
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await apiFetch(path, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((body as { error?: string }).error || `${r.status} ${path}`);
  return body as T;
}

export class ProfileStore {
  current = "";
  defaultId = SHIPPED_ID;
  list: ProfileMeta[] = [];
  dirty = false;
  available = false;
  file = "";
  /** write the current writable profile as settings change */
  autosave = false;
  private saveTimer = 0;
  private saveGen = 0;
  private readonly host: ProfileHost;
  private readonly sel: { setOptions(o: { value: string; label: string; hint?: string }[]): void; value: string; el: HTMLElement };
  private readonly bar: HTMLElement;
  private readonly status: HTMLElement;
  private readonly saveBtn: HTMLButtonElement;
  private readonly discardBtn: HTMLButtonElement;
  private readonly saveAsBtn: HTMLButtonElement;
  private readonly autosaveToggle: Toggle;
  private readonly defaultBtn: HTMLButtonElement;
  private readonly deleteBtn: HTMLButtonElement;

  constructor(host: ProfileHost, sel: ProfileStore["sel"], bar: HTMLElement, tools: HTMLElement) {
    this.host = host;
    this.sel = sel;
    this.bar = bar;
    this.bar.className = "profile-bar";
    this.bar.hidden = true;
    this.status = document.createElement("span");
    this.status.className = "msg";
    const actions = document.createElement("span");
    actions.className = "actions";
    this.saveBtn = btn("Save", "save these settings to the current profile");
    this.discardBtn = btn("Discard", "reload the current profile and drop unsaved changes");
    this.saveAsBtn = btn("Save as…", "write a new profile and make it the startup default");
    actions.append(this.saveBtn, this.discardBtn, this.saveAsBtn);
    this.bar.append(this.status, actions);

    this.autosaveToggle = new Toggle({
      id: "autosave",
      label: "autosave",
      title: "write this profile as you change it (the shipped netviz default cannot be overwritten)",
      checked: false,
      onChange: (on) => void this.setAutosave(on),
    });
    this.defaultBtn = btn("startup default", "load this profile when the page opens");
    this.deleteBtn = btn("delete", "remove this profile");
    this.deleteBtn.classList.add("warn");
    tools.append(this.autosaveToggle.el, this.defaultBtn, this.deleteBtn);

    this.saveBtn.addEventListener("click", () => void this.confirmSave());
    this.discardBtn.addEventListener("click", () => void this.discard());
    this.saveAsBtn.addEventListener("click", () => void this.saveAsNew(true));
    this.defaultBtn.addEventListener("click", () => void this.setDefault(this.current));
    this.deleteBtn.addEventListener("click", () => void this.remove());
  }

  get canAutosave(): boolean {
    return this.available && !!this.current && !this.shipped && this.autosave;
  }

  meta(id = this.current): ProfileMeta | undefined {
    return this.list.find((p) => p.id === id);
  }

  get shipped(): boolean {
    return this.meta()?.shipped === true || this.current === SHIPPED_ID;
  }

  async boot(): Promise<void> {
    try {
      let data = await api<ProfileList>("/api/profiles");
      this.available = true;
      this.file = data.file;
      await api("/api/profiles/shipped", { method: "POST", body: JSON.stringify({ settings: shippedSettings() }) });
      data = await api<ProfileList>("/api/profiles");
      const hasUser = data.profiles.some((p) => p.id === USER_ID);
      if (!hasUser) {
        await api("/api/profiles", {
          method: "POST",
          body: JSON.stringify({
            id: USER_ID,
            label: USER_ID,
            settings: this.host.collect(),
            make_default: data.fresh || data.default === USER_ID || data.default === SHIPPED_ID,
          }),
        });
        data = await api<ProfileList>("/api/profiles");
      }
      this.ingest(data);
      const load = this.list.some((p) => p.id === data.default) ? data.default : SHIPPED_ID;
      await this.load(load, { quiet: true });
    } catch (e) {
      console.warn("zoto-viz profiles:", e);
      this.available = false;
      this.current = USER_ID;
      this.syncChrome();
    }
  }

  touch(): void {
    if (hush || !this.available || !this.current) return;
    if (this.canAutosave) {
      this.scheduleSave();
      return;
    }
    if (!this.dirty) {
      this.dirty = true;
      this.syncChrome();
    }
  }

  /** Apply the flag from a loaded profile without writing. */
  adoptAutosave(on: boolean): void {
    this.autosave = on && !this.shipped;
    this.autosaveToggle.checked = this.autosave;
  }

  async select(id: string): Promise<void> {
    if (id === this.current) return;
    await this.flushPending();
    if (this.dirty) {
      const choice = await ask({
        title: "Unsaved profile",
        body: this.shipped
          ? `Shipped ${SHIPPED_ID} cannot be overwritten. Save as a new profile before switching, or discard the changes.`
          : `Save changes to profile “${this.current}” before switching to “${id}”?`,
        actions: this.shipped
          ? [
              { id: "saveas", label: "Save as…", kind: "primary" },
              { id: "discard", label: "Discard" },
              { id: "cancel", label: "Cancel" },
            ]
          : [
              { id: "save", label: "Save", kind: "primary" },
              { id: "discard", label: "Discard" },
              { id: "cancel", label: "Cancel" },
            ],
      });
      if (!choice || choice.id === "cancel") { this.sel.value = this.current; return; }
      if (choice.id === "save" && !(await this.saveCurrent())) { this.sel.value = this.current; return; }
      if (choice.id === "saveas" && !(await this.saveAsNew(true))) { this.sel.value = this.current; return; }
    }
    try {
      await this.load(id);
    } catch (e) {
      this.sel.value = this.current;
      flash(this.bar, String(e));
    }
  }

  private async load(id: string, opts: { quiet?: boolean } = {}): Promise<void> {
    this.clearTimer();
    const settings = id === SHIPPED_ID
      ? shippedSettings()
      : normalizeSettings((await api<{ settings: unknown }>(`/api/profiles/${id}`)).settings);
    this.current = id;
    this.dirty = false;
    this.sel.value = id;
    const apply = () => { this.host.apply(settings); };
    if (opts.quiet) quiet(apply); else quiet(apply);
    this.adoptAutosave(settings.autosave);
    this.syncChrome();
  }

  private async setAutosave(on: boolean): Promise<void> {
    if (!this.available || this.shipped) {
      this.autosaveToggle.checked = false;
      this.autosave = false;
      this.syncChrome();
      return;
    }
    this.autosave = on;
    this.autosaveToggle.checked = on;
    const ok = await this.writeNow();
    if (!ok) this.dirty = true;
    this.syncChrome();
  }

  private scheduleSave(): void {
    this.clearTimer();
    this.saveTimer = window.setTimeout(() => {
      this.saveTimer = 0;
      void this.writeNow();
    }, AUTOSAVE_DEBOUNCE_MS);
  }

  private clearTimer(): void {
    if (!this.saveTimer) return;
    window.clearTimeout(this.saveTimer);
    this.saveTimer = 0;
  }

  private async flushPending(): Promise<void> {
    if (!this.saveTimer) return;
    this.clearTimer();
    await this.writeNow();
  }

  private async writeNow(): Promise<boolean> {
    if (this.shipped || !this.current || !this.available) return false;
    const gen = ++this.saveGen;
    try {
      await api(`/api/profiles/${this.current}`, {
        method: "PUT",
        body: JSON.stringify({ settings: this.host.collect() }),
      });
      if (gen !== this.saveGen) return true;
      this.dirty = false;
      this.syncChrome();
      return true;
    } catch (e) {
      if (gen !== this.saveGen) return false;
      this.dirty = true;
      this.syncChrome();
      flash(this.bar, String(e));
      return false;
    }
  }

  private async confirmSave(): Promise<void> {
    if (this.shipped) { await this.saveAsNew(true); return; }
    const ok = await ask({
      title: "Save profile",
      body: `Write the current settings to profile “${this.current}” in ${this.file || "~/.zoto-viz/profiles.yml"}?`,
      actions: [
        { id: "save", label: "Save", kind: "primary" },
        { id: "cancel", label: "Cancel" },
      ],
    });
    if (ok?.id === "save") await this.saveCurrent();
  }

  private async saveCurrent(): Promise<boolean> {
    if (this.shipped) return this.saveAsNew(true);
    this.clearTimer();
    const ok = await this.writeNow();
    if (!ok) {
      await ask({ title: "Could not save", body: this.bar.querySelector(".msg")?.textContent || "write failed", actions: [{ id: "ok", label: "OK", kind: "primary" }] });
    }
    return ok;
  }

  private async saveAsNew(makeDefault: boolean): Promise<boolean> {
    this.clearTimer();
    const taken = this.list.map((p) => p.id);
    const suggested = suggestId(taken);
    const result = await ask({
      title: this.shipped ? "Shipped profile is read-only" : "Save as new profile",
      body: this.shipped
        ? `“${SHIPPED_ID}” cannot be edited. Save these settings as a new profile? It becomes the startup default.`
        : "Create a new profile from the current settings.",
      fields: [{ id: "name", label: "profile id", value: suggested, placeholder: "my-lan" }],
      actions: [
        { id: "save", label: makeDefault ? "Save as default" : "Save", kind: "primary" },
        { id: "cancel", label: "Cancel" },
      ],
    });
    if (result?.id !== "save") return false;
    const id = (result.values?.name ?? "").trim().toLowerCase();
    if (!ID_RE.test(id)) {
      await ask({ title: "Invalid id", body: "Use a slug: start with a letter, then letters, digits, _ or -.", actions: [{ id: "ok", label: "OK", kind: "primary" }] });
      return false;
    }
    if (id === SHIPPED_ID) {
      await ask({ title: "Reserved", body: `${SHIPPED_ID} is the shipped default.`, actions: [{ id: "ok", label: "OK", kind: "primary" }] });
      return false;
    }
    try {
      await api("/api/profiles", {
        method: "POST",
        body: JSON.stringify({ id, label: id, settings: this.host.collect(), make_default: makeDefault }),
      });
      const data = await api<ProfileList>("/api/profiles");
      this.ingest(data);
      this.current = id;
      this.dirty = false;
      this.sel.value = id;
      this.syncChrome();
      return true;
    } catch (e) {
      await ask({ title: "Could not save", body: String(e), actions: [{ id: "ok", label: "OK", kind: "primary" }] });
      return false;
    }
  }

  private async discard(): Promise<void> {
    if (!this.current) return;
    try {
      await this.load(this.current);
    } catch (e) {
      flash(this.bar, String(e));
    }
  }

  private async setDefault(id: string): Promise<void> {
    if (!id) return;
    try {
      await api("/api/profiles/default", { method: "PUT", body: JSON.stringify({ id }) });
      this.defaultId = id;
      this.syncChrome();
    } catch (e) {
      await ask({ title: "Could not set default", body: String(e), actions: [{ id: "ok", label: "OK", kind: "primary" }] });
    }
  }

  private async remove(): Promise<void> {
    if (this.shipped) return;
    const ok = await ask({
      title: "Delete profile",
      body: `Delete profile “${this.current}”? The shipped ${SHIPPED_ID} profile is kept.`,
      actions: [
        { id: "delete", label: "Delete", kind: "danger" },
        { id: "cancel", label: "Cancel" },
      ],
    });
    if (ok?.id !== "delete") return;
    try {
      const res = await api<{ default: string }>(`/api/profiles/${this.current}`, { method: "DELETE" });
      const data = await api<ProfileList>("/api/profiles");
      this.ingest(data);
      await this.load(res.default || SHIPPED_ID, { quiet: true });
    } catch (e) {
      await ask({ title: "Could not delete", body: String(e), actions: [{ id: "ok", label: "OK", kind: "primary" }] });
    }
  }

  private ingest(data: ProfileList): void {
    this.list = data.profiles;
    this.defaultId = data.default;
    this.file = data.file;
    this.sel.setOptions(this.list.map((p) => ({
      value: p.id,
      label: p.label,
      hint: [
        p.shipped ? "shipped" : "",
        p.id === this.defaultId ? "startup" : "",
      ].filter(Boolean).join(" · ") || undefined,
    })));
  }

  private syncChrome(): void {
    this.sel.setOptions(this.list.map((p) => ({
      value: p.id,
      label: p.label,
      hint: [
        p.shipped ? "shipped" : "",
        p.id === this.defaultId ? "startup" : "",
        p.id === this.current && this.canAutosave ? "autosave" : "",
        p.id === this.current && this.dirty ? "unsaved" : "",
      ].filter(Boolean).join(" · ") || undefined,
    })));
    this.sel.value = this.current || this.list[0]?.id || "";
    this.sel.el.classList.toggle("dirty", this.dirty);
    this.sel.el.classList.toggle("shipped", this.shipped);
    this.autosaveToggle.checked = this.canAutosave;
    this.autosaveToggle.disabled = !this.available || this.shipped;
    this.autosaveToggle.el.title = this.shipped
      ? "the shipped netviz profile cannot be overwritten; switch to a writable profile to autosave"
      : "write this profile as you change it (the shipped netviz default cannot be overwritten)";
    this.defaultBtn.disabled = !this.available || !this.current || this.current === this.defaultId;
    this.deleteBtn.disabled = !this.available || this.shipped || this.list.filter((p) => !p.shipped).length === 0;
    this.saveAsBtn.hidden = false;

    if (!this.available) {
      this.bar.hidden = false;
      this.status.textContent = "Profiles file unavailable — settings stay in this browser until the monitor can write ~/.zoto-viz/profiles.yml.";
      this.saveBtn.hidden = true;
      this.discardBtn.hidden = true;
      this.saveAsBtn.hidden = true;
      return;
    }
    this.saveBtn.hidden = false;
    this.discardBtn.hidden = false;
    if (!this.dirty) {
      this.bar.hidden = true;
      return;
    }
    this.bar.hidden = false;
    if (this.shipped) {
      this.status.textContent = `Shipped “${SHIPPED_ID}” cannot be edited. Save as a new profile to keep these settings (it becomes the startup default).`;
      this.saveBtn.hidden = true;
      this.saveAsBtn.hidden = false;
    } else {
      this.status.textContent = `Unsaved changes to profile “${this.current}”.`;
      this.saveBtn.hidden = false;
    }
  }
}

function btn(label: string, title: string): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "btn small";
  b.textContent = label;
  b.title = title;
  return b;
}

function flash(bar: HTMLElement, msg: string): void {
  bar.hidden = false;
  const el = bar.querySelector(".msg");
  if (el) el.textContent = msg;
}

interface AskAction { id: string; label: string; kind?: "primary" | "danger" | "ghost" }
interface AskField { id: string; label: string; value?: string; placeholder?: string }
interface AskResult { id: string; values: Record<string, string> }

function ask(opts: { title: string; body: string; fields?: AskField[]; actions: AskAction[] }): Promise<AskResult | null> {
  return new Promise((resolve) => {
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
    h.textContent = opts.title;
    head.appendChild(h);
    const body = document.createElement("div");
    body.className = "ask-body";
    const p = document.createElement("p");
    p.textContent = opts.body;
    body.appendChild(p);
    const fields = new Map<string, HTMLInputElement>();
    for (const f of opts.fields ?? []) {
      const lab = document.createElement("label");
      lab.className = "ask-field";
      const cap = document.createElement("span");
      cap.className = "cap";
      cap.textContent = f.label;
      const input = document.createElement("input");
      input.type = "text";
      input.spellcheck = false;
      input.autocomplete = "off";
      input.value = f.value ?? "";
      if (f.placeholder) input.placeholder = f.placeholder;
      lab.append(cap, input);
      body.appendChild(lab);
      fields.set(f.id, input);
    }
    const row = document.createElement("div");
    row.className = "ask-actions";
    const finish = (id: string | null) => {
      document.body.classList.remove("modal-open");
      modal.remove();
      document.removeEventListener("keydown", onKey, true);
      if (id === null) { resolve(null); return; }
      const values: Record<string, string> = {};
      for (const [k, input] of fields) values[k] = input.value;
      resolve({ id, values });
    };
    for (const a of opts.actions) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = `btn${a.kind === "primary" ? " primary" : a.kind === "danger" ? " danger" : ""}`;
      b.textContent = a.label;
      b.addEventListener("click", () => finish(a.id));
      row.appendChild(b);
    }
    sheet.append(head, body, row);
    modal.append(back, sheet);
    back.addEventListener("click", () => finish("cancel"));
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); finish("cancel"); }
      if (e.key === "Enter" && fields.size) {
        e.preventDefault();
        finish(opts.actions.find((a) => a.kind === "primary")?.id ?? opts.actions[0]!.id);
      }
    };
    document.addEventListener("keydown", onKey, true);
    document.body.classList.add("modal-open");
    document.body.appendChild(modal);
    const first = opts.fields?.[0] && fields.get(opts.fields[0].id);
    (first ?? row.querySelector("button.primary") ?? row.querySelector("button"))?.focus();
  });
}
