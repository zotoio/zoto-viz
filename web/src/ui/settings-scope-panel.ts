/**
 * The scope control, breadcrumb, field status, and reset for This view.
 * An edit writes only the level on screen.
 */
import { emptyScopeStore, separateTile, setAt, resetAt, resolve, type ScopeStore, type WriteLevel } from "../core/settings-scope";
import { SEPARATE_TILE, TILE_OWN_SETTINGS, shareWithPack } from "../core/scope-copy";

export type ScopeEntry = "global" | "view" | "tile";

export type ScopeChoice = {
  id: WriteLevel;
  label: string;
};

export type ScopePanelOpts = {
  entry: ScopeEntry;
  /** 1-based tile number when the tile cog opened the drawer. */
  tileIndex?: number;
  packName?: string;
  viewName?: string;
  wallName?: string;
};

const ANNOUNCE: Record<WriteLevel, (o: ScopePanelOpts) => string> = {
  global: () => "Editing Global. Changes apply everywhere.",
  wall: (o) => `Editing Wall "${o.wallName || "default"}". Changes apply to this wall.`,
  pack: (o) => `Editing ${o.packName || "Pack"}. Changes apply to this pack.`,
  view: (o) => `Editing ${o.viewName || "this view"}. Changes apply to this view.`,
  tile: (o) => `Editing Tile ${o.tileIndex ?? 1} · ${o.packName || "this pack"}. Changes apply to this tile only.`,
};

export function scopeChoices(opts: ScopePanelOpts): ScopeChoice[] {
  const choices: ScopeChoice[] = [
    { id: "global", label: "Global" },
    { id: "wall", label: "Wall" },
  ];
  if (opts.packName) choices.push({ id: "pack", label: opts.packName });
  if (opts.entry !== "global" || opts.viewName) choices.push({ id: "view", label: "View" });
  if (opts.entry === "tile") choices.push({ id: "tile", label: `Tile ${opts.tileIndex ?? 1}` });
  return choices;
}

export function defaultScopeLevel(entry: ScopeEntry): WriteLevel {
  if (entry === "tile") return "tile";
  if (entry === "view") return "view";
  return "global";
}

export function settingsForTileLabel(index: number, name: string): string {
  return `Settings for tile ${index}: ${name}`;
}

export function fieldStatusText(args: {
  setHere: boolean;
  globalOnly?: boolean;
  packDefault?: boolean;
  fromLevel?: string;
  fromValue?: string;
}): string {
  if (args.globalOnly) return "Global only";
  if (args.packDefault && !args.setHere) return "Pack default";
  if (args.setHere) return "Set here";
  return `From ${args.fromLevel} (${args.fromValue})`;
}

export function resetFieldName(field: string, level: string, value: string): string {
  return `Reset ${field} to ${level} value, ${value}`;
}

export function breadcrumbText(opts: ScopePanelOpts): string {
  const parts = ["Global"];
  if (opts.packName) parts.push(opts.packName);
  if (opts.viewName) parts.push(opts.viewName);
  parts.push(`Wall "${opts.wallName || "default"}"`);
  if (opts.entry === "tile") parts.push(`Tile ${opts.tileIndex ?? 1}`);
  return parts.join(" › ");
}

export class SettingsScopePanel {
  readonly el: HTMLElement;
  readonly polite: HTMLElement;
  level: WriteLevel;
  private readonly opts: ScopePanelOpts;
  private announcements = 0;

  constructor(opts: ScopePanelOpts) {
    this.opts = opts;
    this.level = defaultScopeLevel(opts.entry);
    this.el = document.createElement("div");
    this.el.className = "settings-scope";
    const tabs = document.createElement("div");
    tabs.className = "settings-scope-tabs";
    tabs.setAttribute("role", "tablist");
    tabs.tabIndex = 0;
    for (const choice of scopeChoices(opts)) {
      const b = document.createElement("button");
      b.type = "button";
      b.setAttribute("role", "tab");
      b.dataset.level = choice.id;
      b.textContent = choice.label;
      b.setAttribute("aria-selected", choice.id === this.level ? "true" : "false");
      b.tabIndex = choice.id === this.level ? 0 : -1;
      b.addEventListener("click", () => this.select(choice.id));
      tabs.appendChild(b);
    }
    tabs.addEventListener("keydown", (e) => this.onKey(e));
    const crumbs = document.createElement("div");
    crumbs.className = "settings-scope-crumbs";
    for (const part of breadcrumbText(opts).split(" › ")) {
      const c = document.createElement("button");
      c.type = "button";
      c.className = "settings-scope-crumb";
      c.textContent = part;
      crumbs.appendChild(c);
    }
    this.polite = document.createElement("div");
    this.polite.className = "settings-scope-polite";
    this.polite.setAttribute("role", "status");
    this.polite.setAttribute("aria-live", "polite");
    this.el.append(tabs, crumbs, this.polite);
    if (opts.packName) {
      const note = document.createElement("p");
      note.className = "settings-scope-pack";
      note.textContent = `Applies to all ${opts.packName} tiles`;
      this.el.append(note);
    }
    if (opts.entry === "tile") {
      const separate = document.createElement("button");
      separate.type = "button";
      separate.className = "settings-scope-separate";
      separate.textContent = SEPARATE_TILE;
      const share = document.createElement("button");
      share.type = "button";
      share.className = "settings-scope-share";
      share.hidden = true;
      share.textContent = shareWithPack(opts.packName || "this pack");
      const own = document.createElement("p");
      own.className = "settings-scope-own";
      own.hidden = true;
      own.textContent = TILE_OWN_SETTINGS;
      separate.addEventListener("click", () => {
        this.separated = true;
        separate.hidden = true;
        share.hidden = false;
        own.hidden = false;
      });
      this.el.append(separate, own, share);
    }
  }

  private separated = false;

  /** Status text next to a field, named for assistive tech, and a reset that deletes the override. */
  attachField(row: HTMLElement, field: string, status: string, resetLabel: string): void {
    const id = `scope-status-${field}`;
    let note = row.querySelector<HTMLElement>(".settings-scope-status");
    if (!note) {
      note = document.createElement("span");
      note.className = "settings-scope-status";
      note.id = id;
      row.append(note);
    }
    note.textContent = status;
    const control = row.querySelector<HTMLElement>("input,select,button,textarea") ?? row;
    control.setAttribute("aria-describedby", note.id);
    let reset = row.querySelector<HTMLButtonElement>(".settings-scope-reset");
    if (!reset) {
      reset = document.createElement("button");
      reset.type = "button";
      reset.className = "settings-scope-reset";
      row.append(reset);
    }
    reset.textContent = "Reset";
    reset.setAttribute("aria-label", resetLabel);
  }

  private tabs(): HTMLButtonElement[] {
    return [...this.el.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
  }

  select(level: WriteLevel): void {
    if (level === this.level) return;
    if (!this.tabs().some((t) => t.dataset.level === level)) return;
    this.level = level;
    for (const tab of this.tabs()) {
      const on = tab.dataset.level === level;
      tab.setAttribute("aria-selected", on ? "true" : "false");
      tab.tabIndex = on ? 0 : -1;
    }
    this.polite.textContent = ANNOUNCE[level](this.opts);
    this.announcements += 1;
  }

  get announcementCount(): number { return this.announcements; }

  private onKey(e: KeyboardEvent): void {
    const tabs = this.tabs();
    const i = tabs.findIndex((t) => t.dataset.level === this.level);
    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      e.preventDefault();
      const next = tabs[(i + 1) % tabs.length];
      if (next?.dataset.level) this.select(next.dataset.level as WriteLevel);
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      e.preventDefault();
      const next = tabs[(i - 1 + tabs.length) % tabs.length];
      if (next?.dataset.level) this.select(next.dataset.level as WriteLevel);
    } else if (e.key === "Home") {
      e.preventDefault();
      const next = tabs[0];
      if (next?.dataset.level) this.select(next.dataset.level as WriteLevel);
    } else if (e.key === "End") {
      e.preventDefault();
      const next = tabs[tabs.length - 1];
      if (next?.dataset.level) this.select(next.dataset.level as WriteLevel);
    }
  }

  /** An edit writes exactly this level. Global is untouched when the level is Tile. */
  private ctx() {
    return {
      packId: this.opts.packName || "",
      viewId: this.opts.viewName || "",
      wallId: "default",
      tileId: this.opts.entry === "tile" ? `tile-${this.opts.tileIndex ?? 1}` : (this.opts.viewName || ""),
    };
  }

  write(store: ScopeStore, key: string, value: string): ScopeStore {
    const ctx = this.ctx();
    const base = this.level === "tile" ? separateTile(store, ctx.tileId) : store;
    const wrote = setAt(base, this.level, key, value, ctx);
    return wrote.ok ? wrote.store : store;
  }

  reset(store: ScopeStore, key: string): { store: ScopeStore; status: string; name: string } {
    const ctx = this.ctx();
    const base = this.level === "tile" ? separateTile(store, ctx.tileId) : store;
    const next = resetAt(base, this.level, key, ctx);
    const inherited = resolve(next, key, ctx);
    const from = inherited == null ? "built-in" : "Global";
    const shown = inherited == null ? "" : String(inherited);
    return {
      store: next,
      status: fieldStatusText({ setHere: false, fromLevel: from, fromValue: shown || "default" }),
      name: resetFieldName(key, from, shown || "default"),
    };
  }
}

export function freshScopeStore(): ScopeStore {
  return emptyScopeStore();
}
