/**
 * Small custom form controls for the header. Native <select> / <input type=checkbox> cannot be styled
 * consistently across browsers (popup, dark scheme, sizing), so the header uses these instead:
 *
 * - Select: a two-line field (caption over value) that opens a listbox popup. Keyboard: Enter/Space/Arrows
 *   open, Arrows move, Enter picks, Escape closes; Home/End jump. Only one popup is open at a time.
 * - Toggle: a switch with a text label. Keeps a real (visually hidden) checkbox underneath, so focus,
 *   keyboard and form semantics come for free.
 * - Group: a caption over a row of toggles, so toggle clusters line up with the two-line selects.
 */

export interface SelectOption {
  value: string;
  label: string;
  /** secondary text, shown muted after the label in the menu */
  hint?: string;
  /** CSS background for a small swatch in front of the label (colour or gradient) */
  swatch?: string;
  /** optional section header; consecutive options with the same group share one label */
  group?: string;
}

export interface SelectConfig {
  caption: string;
  options: SelectOption[];
  value?: string;
  title?: string;
  id?: string;
  /** show a type-to-filter field when the menu has many rows (default: 8+) */
  filterable?: boolean;
  onChange?: (value: string, opt: SelectOption) => void;
}

let openSelect: Select | null = null;

const CHEVRON = `<svg class="chev" viewBox="0 0 10 10" aria-hidden="true"><path d="M1.5 3.5 5 7l3.5-3.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

/** Park a popup on the document so a scrolling side bar cannot clip it. */
export function pinFlyout(el: HTMLElement, trigger: HTMLElement, side: "left" | "right"): void {
  const r = trigger.getBoundingClientRect();
  const bar = document.getElementById("bar")?.getBoundingClientRect() ?? r;
  el.classList.add("flyout");
  document.body.appendChild(el);
  const h = el.offsetHeight;
  el.style.setProperty("position", "fixed");
  el.style.setProperty("top", `${Math.max(8, Math.min(r.top, innerHeight - h - 8))}px`);
  if (side === "left") {
    el.style.setProperty("left", `${bar.right + 6}px`);
    el.style.setProperty("right", "auto");
  } else {
    el.style.setProperty("right", `${innerWidth - bar.left + 6}px`);
    el.style.setProperty("left", "auto");
  }
}

export function unpinFlyout(el: HTMLElement, home: HTMLElement): void {
  el.classList.remove("flyout");
  el.style.position = "";
  el.style.top = "";
  el.style.left = "";
  el.style.right = "";
  home.appendChild(el);
}

export class Select {
  readonly el: HTMLDivElement;
  private readonly btn: HTMLButtonElement;
  private readonly valEl: HTMLSpanElement;
  private readonly menu: HTMLUListElement;
  private options: SelectOption[] = [];
  private items: HTMLLIElement[] = [];
  private current = "";
  private active = -1;
  private filter = "";
  private readonly filterable: boolean;
  private readonly menuId: string;
  onChange: (value: string, opt: SelectOption) => void;

  constructor(cfg: SelectConfig) {
    this.onChange = cfg.onChange ?? (() => {});
    this.filterable = cfg.filterable ?? cfg.options.length >= 8;
    this.menuId = `menu-${Math.random().toString(36).slice(2, 8)}`;
    this.el = document.createElement("div");
    this.el.className = "field select";
    if (cfg.id) this.el.id = cfg.id;

    this.btn = document.createElement("button");
    this.btn.type = "button";
    this.btn.className = "field-btn";
    this.btn.setAttribute("aria-haspopup", "listbox");
    this.btn.setAttribute("aria-expanded", "false");
    this.btn.setAttribute("aria-controls", this.menuId);
    if (cfg.title) this.btn.title = cfg.title;
    const cap = document.createElement("span");
    cap.className = "cap";
    cap.textContent = cfg.caption;
    this.valEl = document.createElement("span");
    this.valEl.className = "val";
    this.btn.append(cap, this.valEl);

    this.menu = document.createElement("ul");
    this.menu.className = "menu";
    this.menu.id = this.menuId;
    this.menu.setAttribute("role", "listbox");
    this.menu.hidden = true;

    this.el.append(this.btn, this.menu);
    this.setOptions(cfg.options);
    this.value = cfg.value ?? cfg.options[0]?.value ?? "";

    this.btn.addEventListener("click", () => (this.isOpen ? this.close() : this.open()));
    this.btn.addEventListener("keydown", (e) => this.onButtonKey(e));
    this.menu.addEventListener("pointerdown", (e) => {
      if ((e.target as HTMLElement).closest("input")) return;
      e.preventDefault();
    });
    this.menu.addEventListener("pointermove", (e) => {
      const li = (e.target as HTMLElement).closest("li[role='option']");
      if (li) this.setActive(this.items.indexOf(li as HTMLLIElement));
    });
    this.menu.addEventListener("click", (e) => {
      const li = (e.target as HTMLElement).closest("li[role='option']");
      if (li) this.pick(this.items.indexOf(li as HTMLLIElement));
    });
  }

  get value(): string { return this.current; }
  /** Set the value without firing onChange. */
  set value(v: string) {
    const opt = this.options.find((o) => o.value === v) ?? this.options[0];
    if (!opt) { this.current = ""; this.valEl.innerHTML = CHEVRON; return; }
    this.current = opt.value;
    this.valEl.innerHTML = "";
    if (opt.swatch) this.valEl.appendChild(swatch(opt.swatch));
    const txt = document.createElement("span");
    txt.className = "txt";
    txt.textContent = opt.label;
    this.valEl.appendChild(txt);
    this.valEl.insertAdjacentHTML("beforeend", CHEVRON);
    for (const li of this.items) li.setAttribute("aria-selected", li.dataset.value === opt.value ? "true" : "false");
  }

  setOptions(options: SelectOption[]): void {
    this.options = options;
    this.renderMenu();
    if (this.current) this.value = this.current;
  }

  private visibleOptions(): SelectOption[] {
    const q = this.filter.trim().toLowerCase();
    if (!q) return this.options;
    return this.options.filter((o) =>
      o.label.toLowerCase().includes(q)
      || o.value.toLowerCase().includes(q)
      || (o.hint ?? "").toLowerCase().includes(q)
      || (o.group ?? "").toLowerCase().includes(q));
  }

  private renderMenu(): void {
    this.menu.innerHTML = "";
    this.items = [];
    if (this.filterable) {
      const filterLi = document.createElement("li");
      filterLi.className = "menu-filter";
      filterLi.setAttribute("role", "presentation");
      const input = document.createElement("input");
      input.type = "search";
      input.className = "menu-filter-input";
      input.placeholder = "filter…";
      input.setAttribute("aria-label", "filter options");
      input.autocomplete = "off";
      input.spellcheck = false;
      input.value = this.filter;
      input.addEventListener("input", () => {
        this.filter = input.value;
        this.renderMenu();
        const next = this.menu.querySelector<HTMLInputElement>(".menu-filter-input");
        if (next) {
          next.focus();
          const end = next.value.length;
          next.setSelectionRange(end, end);
        }
        this.setActive(Math.max(0, this.items.findIndex((li) => li.dataset.value === this.current)));
      });
      input.addEventListener("keydown", (e) => this.onMenuKey(e));
      filterLi.appendChild(input);
      this.menu.appendChild(filterLi);
    }
    let lastGroup = "";
    const visible = this.visibleOptions();
    visible.forEach((o, i) => {
      if (o.group && o.group !== lastGroup) {
        lastGroup = o.group;
        const head = document.createElement("li");
        head.className = "menu-group";
        head.setAttribute("role", "presentation");
        head.textContent = o.group;
        this.menu.appendChild(head);
      }
      const li = document.createElement("li");
      li.setAttribute("role", "option");
      li.id = `${this.menuId}-${i}`;
      li.dataset.value = o.value;
      if (o.swatch) li.appendChild(swatch(o.swatch));
      const txt = document.createElement("span");
      txt.className = "txt";
      txt.textContent = o.label;
      li.appendChild(txt);
      if (o.hint) {
        const s = document.createElement("small");
        s.textContent = o.hint;
        li.appendChild(s);
      }
      this.menu.appendChild(li);
      this.items.push(li);
    });
    if (!visible.length) {
      const empty = document.createElement("li");
      empty.className = "menu-empty";
      empty.setAttribute("role", "presentation");
      empty.textContent = "no matches";
      this.menu.appendChild(empty);
    }
    if (this.current) {
      for (const li of this.items) li.setAttribute("aria-selected", li.dataset.value === this.current ? "true" : "false");
    }
  }

  get isOpen(): boolean { return !this.menu.hidden; }

  open(): void {
    if (this.isOpen) return;
    if (openSelect && openSelect !== this) openSelect.close();
    openSelect = this;
    this.filter = "";
    this.renderMenu();
    this.menu.hidden = false;
    this.el.classList.add("open");
    this.btn.setAttribute("aria-expanded", "true");
    this.setActive(Math.max(0, this.items.findIndex((li) => li.dataset.value === this.current)));
    document.addEventListener("pointerdown", this.onDocDown, true);
    window.addEventListener("blur", this.closeBound);
    const chrome = document.body.dataset.chrome;
    if (chrome === "left" || chrome === "right") {
      this.menu.classList.remove("up", "right");
      pinFlyout(this.menu, this.btn, chrome);
    } else {
      unpinFlyout(this.menu, this.el);
      const r = this.menu.getBoundingClientRect();
      this.menu.classList.toggle("up", r.bottom > innerHeight - 8);
      this.menu.classList.toggle("right", r.right > innerWidth - 8);
    }
    if (this.filterable) this.menu.querySelector<HTMLInputElement>(".menu-filter-input")?.focus();
  }

  private closeBound = () => this.close();
  close(): void {
    if (!this.isOpen) return;
    this.menu.hidden = true;
    this.el.classList.remove("open");
    this.btn.setAttribute("aria-expanded", "false");
    this.btn.removeAttribute("aria-activedescendant");
    unpinFlyout(this.menu, this.el);
    document.removeEventListener("pointerdown", this.onDocDown, true);
    window.removeEventListener("blur", this.closeBound);
    if (openSelect === this) openSelect = null;
  }

  private onDocDown = (e: PointerEvent) => {
    const t = e.target as Node;
    if (!this.el.contains(t) && !this.menu.contains(t)) this.close();
  };

  private setActive(i: number): void {
    this.active = i;
    this.items.forEach((li, k) => li.classList.toggle("active", k === i));
    const li = this.items[i];
    if (li) {
      this.btn.setAttribute("aria-activedescendant", li.id);
      li.scrollIntoView({ block: "nearest" });
    }
  }

  private pick(i: number): void {
    const value = this.items[i]?.dataset.value;
    const opt = this.options.find((o) => o.value === value);
    this.close();
    if (!opt || opt.value === this.current) return;
    this.value = opt.value;
    this.onChange(opt.value, opt);
  }

  private onMenuKey(e: KeyboardEvent): void {
    const n = this.items.length;
    if (!n) {
      if (e.key === "Escape") { e.preventDefault(); this.close(); this.btn.focus(); }
      return;
    }
    switch (e.key) {
      case "ArrowDown": e.preventDefault(); this.setActive((this.active + 1 + n) % n); break;
      case "ArrowUp": e.preventDefault(); this.setActive((this.active - 1 + n) % n); break;
      case "Home": e.preventDefault(); this.setActive(0); break;
      case "End": e.preventDefault(); this.setActive(n - 1); break;
      case "Enter": e.preventDefault(); this.pick(this.active); this.btn.focus(); break;
      case "Escape": e.preventDefault(); this.close(); this.btn.focus(); break;
      case "Tab": this.close(); break;
    }
  }

  private onButtonKey(e: KeyboardEvent): void {
    if (!this.isOpen) {
      if (["Enter", " ", "ArrowDown", "ArrowUp"].includes(e.key)) { e.preventDefault(); this.open(); }
      return;
    }
    this.onMenuKey(e);
  }
}

export interface ChipOption<T extends string = string> {
  value: T;
  label: string;
  hint?: string;
  group: string;
}

export interface ChipGroup {
  id: string;
  label: string;
}

export interface GroupedChipsConfig<T extends string> {
  label: string;
  options: ChipOption<T>[];
  groups: ChipGroup[];
  value: T;
  onChange?: (value: T) => void;
}

/** Searchable chip row with group tabs — used when a radiogroup would wrap into a pile. */
export class GroupedChips<T extends string> {
  readonly el: HTMLDivElement;
  private readonly chips: HTMLDivElement;
  private readonly search: HTMLInputElement;
  private readonly tabs = new Map<string, HTMLButtonElement>();
  private readonly btns = new Map<T, HTMLButtonElement>();
  private group = "all";
  private query = "";
  private current: T;
  onChange: (value: T) => void;

  constructor(cfg: GroupedChipsConfig<T>) {
    this.onChange = cfg.onChange ?? (() => {});
    this.current = cfg.value;
    this.el = document.createElement("div");
    this.el.className = "chip-picker";

    const toolbar = document.createElement("div");
    toolbar.className = "chip-toolbar";
    this.search = document.createElement("input");
    this.search.type = "search";
    this.search.className = "chip-search";
    this.search.placeholder = "filter skies…";
    this.search.setAttribute("aria-label", `filter ${cfg.label}`);
    this.search.autocomplete = "off";
    this.search.spellcheck = false;
    this.search.addEventListener("input", () => {
      this.query = this.search.value;
      this.paint();
    });

    const tabs = document.createElement("div");
    tabs.className = "chip-groups";
    tabs.setAttribute("role", "tablist");
    tabs.setAttribute("aria-label", `${cfg.label} groups`);
    for (const g of cfg.groups) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "chip-group";
      b.textContent = g.label;
      b.dataset.group = g.id;
      b.setAttribute("role", "tab");
      b.addEventListener("click", () => {
        this.group = g.id;
        this.paint();
      });
      this.tabs.set(g.id, b);
      tabs.appendChild(b);
    }
    toolbar.append(this.search, tabs);

    this.chips = document.createElement("div");
    this.chips.className = "skypick";
    this.chips.setAttribute("role", "radiogroup");
    this.chips.setAttribute("aria-label", cfg.label);
    for (const o of cfg.options) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "sky";
      b.textContent = o.label;
      b.title = o.hint ?? o.label;
      b.dataset.value = o.value;
      b.dataset.group = o.group;
      b.addEventListener("click", () => {
        this.current = o.value;
        this.syncPressed();
        this.onChange(o.value);
      });
      this.btns.set(o.value, b);
      this.chips.appendChild(b);
    }

    this.el.append(toolbar, this.chips);
    this.paint();
  }

  get value(): T { return this.current; }
  set(v: T): void {
    this.current = v;
    this.syncPressed();
    const btn = this.btns.get(v);
    if (btn?.hidden && this.group !== "all") {
      this.group = "all";
      this.paint();
    }
  }

  private syncPressed(): void {
    for (const [k, btn] of this.btns) btn.setAttribute("aria-pressed", k === this.current ? "true" : "false");
  }

  private paint(): void {
    const q = this.query.trim().toLowerCase();
    for (const [id, tab] of this.tabs) tab.setAttribute("aria-selected", id === this.group ? "true" : "false");
    for (const btn of this.btns.values()) {
      const groupOk = this.group === "all" || btn.dataset.group === this.group;
      const text = `${btn.textContent ?? ""} ${btn.title}`.toLowerCase();
      btn.hidden = !(groupOk && (!q || text.includes(q)));
    }
    this.syncPressed();
  }
}

export interface TextFieldConfig {
  caption: string;
  value?: string;
  placeholder?: string;
  title?: string;
  id?: string;
  /** fired on every edit (already debounced by the caller if needed) */
  onInput?: (value: string) => void;
}

/** A caption + text input on the same 30px row as the selects (NetPong's matcher pattern). */
export class TextField {
  readonly el: HTMLLabelElement;
  readonly input: HTMLInputElement;
  onInput: (value: string) => void;

  constructor(cfg: TextFieldConfig) {
    this.onInput = cfg.onInput ?? (() => {});
    this.el = document.createElement("label");
    this.el.className = "field text";
    if (cfg.title) this.el.title = cfg.title;
    const cap = document.createElement("span");
    cap.className = "cap";
    cap.textContent = cfg.caption;
    this.input = document.createElement("input");
    this.input.type = "text";
    this.input.spellcheck = false;
    this.input.setAttribute("autocomplete", "off");
    if (cfg.id) this.input.id = cfg.id;
    if (cfg.placeholder) this.input.placeholder = cfg.placeholder;
    this.input.value = cfg.value ?? "";
    this.el.append(cap, this.input);
    this.input.addEventListener("input", () => this.onInput(this.input.value));
  }

  get value(): string { return this.input.value; }
  /** Set without firing onInput. */
  set value(v: string) { this.input.value = v; }
  get hidden(): boolean { return this.el.hidden === true; }
  set hidden(v: boolean) { this.el.hidden = v; }
  focus(): void { this.input.focus(); }
}

export interface SliderConfig {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  title?: string;
  format?: (v: number) => string;
  onInput?: (value: number) => void;
}

/** Caption + live value over a range input, used by the settings cog's animation sliders. */
export class Slider {
  readonly el: HTMLLabelElement;
  private readonly input: HTMLInputElement;
  private readonly valEl: HTMLSpanElement;
  private readonly format: (v: number) => string;
  onInput: (value: number) => void;

  constructor(cfg: SliderConfig) {
    this.onInput = cfg.onInput ?? (() => {});
    this.format = cfg.format ?? ((v) => String(v));
    this.el = document.createElement("label");
    this.el.className = "slider";
    if (cfg.title) this.el.title = cfg.title;
    const cap = document.createElement("span");
    cap.className = "cap";
    cap.textContent = cfg.label;
    this.valEl = document.createElement("span");
    this.valEl.className = "val";
    this.input = document.createElement("input");
    this.input.type = "range";
    this.input.min = String(cfg.min);
    this.input.max = String(cfg.max);
    this.input.step = String(cfg.step);
    this.input.value = String(cfg.value);
    this.valEl.textContent = this.format(cfg.value);
    this.el.append(cap, this.valEl, this.input);
    this.input.addEventListener("input", () => {
      this.valEl.textContent = this.format(this.value);
      this.onInput(this.value);
    });
  }

  get value(): number { return Number(this.input.value); }
  /** Set without firing onInput. */
  set value(v: number) {
    this.input.value = String(v);
    this.valEl.textContent = this.format(this.value);
  }
}

export interface ColorFieldConfig {
  label: string;
  /** empty string follows the theme */
  value: string;
  themeHex: string;
  title?: string;
  onInput?: (value: string) => void;
}

/** Caption, theme chip, and a native colour well. Empty value means "use the active theme". */
export class ColorField {
  readonly el: HTMLDivElement;
  private readonly swatch: HTMLInputElement;
  private readonly themeBtn: HTMLButtonElement;
  private readonly valEl: HTMLSpanElement;
  private themeHex: string;
  private current: string;
  onInput: (value: string) => void;

  constructor(cfg: ColorFieldConfig) {
    this.onInput = cfg.onInput ?? (() => {});
    this.themeHex = cfg.themeHex;
    this.current = cfg.value;
    this.el = document.createElement("div");
    this.el.className = "colorfield";
    if (cfg.title) this.el.title = cfg.title;
    const cap = document.createElement("span");
    cap.className = "cap";
    cap.textContent = cfg.label;
    this.valEl = document.createElement("span");
    this.valEl.className = "val";
    this.themeBtn = document.createElement("button");
    this.themeBtn.type = "button";
    this.themeBtn.className = "sky";
    this.themeBtn.textContent = "theme";
    this.themeBtn.title = "follow the active colour theme";
    this.swatch = document.createElement("input");
    this.swatch.type = "color";
    this.swatch.title = "custom colour";
    const row = document.createElement("div");
    row.className = "row";
    row.append(this.themeBtn, this.swatch);
    this.el.append(cap, this.valEl, row);
    this.sync();
    this.themeBtn.addEventListener("click", () => {
      this.current = "";
      this.sync();
      this.onInput("");
    });
    this.swatch.addEventListener("input", () => {
      this.current = this.swatch.value.toLowerCase();
      this.sync();
      this.onInput(this.current);
    });
  }

  get value(): string { return this.current; }
  /** Set without firing onInput. Empty string follows the theme. */
  set value(v: string) { this.current = v; this.sync(); }

  setThemeHex(hex: string): void {
    this.themeHex = hex;
    if (!this.current) this.sync();
  }

  private sync(): void {
    const hex = this.current || this.themeHex;
    this.swatch.value = hex;
    this.valEl.textContent = this.current || "theme";
    this.themeBtn.setAttribute("aria-pressed", this.current ? "false" : "true");
  }
}

function swatch(bg: string): HTMLElement {
  const i = document.createElement("i");
  i.className = "sw";
  i.style.background = bg;
  return i;
}

export interface ToggleConfig {
  label: string;
  checked?: boolean;
  title?: string;
  id?: string;
  /** extra class on the wrapper, e.g. "warn" for the redact switch */
  className?: string;
  onChange?: (checked: boolean) => void;
}

export class Toggle {
  readonly el: HTMLLabelElement;
  readonly input: HTMLInputElement;
  onChange: (checked: boolean) => void;

  constructor(cfg: ToggleConfig) {
    this.onChange = cfg.onChange ?? (() => {});
    this.el = document.createElement("label");
    this.el.className = `toggle${cfg.className ? ` ${cfg.className}` : ""}`;
    if (cfg.title) this.el.title = cfg.title;
    this.input = document.createElement("input");
    this.input.type = "checkbox";
    if (cfg.id) this.input.id = cfg.id;
    this.input.checked = cfg.checked ?? false;
    const track = document.createElement("span");
    track.className = "track";
    track.innerHTML = `<span class="knob"></span>`;
    const txt = document.createElement("span");
    txt.className = "txt";
    txt.textContent = cfg.label;
    this.el.append(this.input, track, txt);
    this.input.addEventListener("change", () => this.onChange(this.input.checked));
  }

  get checked(): boolean { return this.input.checked; }
  /** Set without firing onChange. */
  set checked(v: boolean) { this.input.checked = v; }
  get disabled(): boolean { return this.input.disabled; }
  set disabled(v: boolean) {
    this.input.disabled = v;
    this.el.classList.toggle("disabled", v);
    this.el.setAttribute("aria-disabled", v ? "true" : "false");
  }
}

const DICE_ICON = `<svg viewBox="0 0 20 20" aria-hidden="true" width="16" height="16"><rect x="1.8" y="1.8" width="16.4" height="16.4" rx="3.4" fill="currentColor" opacity="0.18"/><rect x="1.8" y="1.8" width="16.4" height="16.4" rx="3.4" fill="none" stroke="currentColor" stroke-width="1.7"/><circle cx="6.6" cy="6.6" r="1.35" fill="currentColor"/><circle cx="13.4" cy="6.6" r="1.35" fill="currentColor"/><circle cx="10" cy="10" r="1.35" fill="currentColor"/><circle cx="6.6" cy="13.4" r="1.35" fill="currentColor"/><circle cx="13.4" cy="13.4" r="1.35" fill="currentColor"/></svg>`;

/** Header dice: left switch is repeat; right icon is a one-shot roll that does not toggle. */
export function mountDiceSplit(box: HTMLElement, toggle: Toggle, onRoll: () => void): HTMLButtonElement {
  box.classList.add("dice-split");
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "dice-roll";
  btn.title = "roll now";
  btn.setAttribute("aria-label", "roll now");
  btn.innerHTML = DICE_ICON;
  btn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (toggle.disabled) return;
    onRoll();
  });
  box.append(toggle.el, btn);
  return btn;
}

/** Crossfade an element's text so HUD / hint / feed captions morph instead of snapping. */
export function morphCopy(el: HTMLElement, text: string, ms = 420): void {
  if ((el.dataset.morphTo ?? el.textContent) === text) return;
  el.dataset.morphTo = text;
  el.classList.add("morphing");
  window.setTimeout(() => {
    if (el.dataset.morphTo !== text) return;
    el.textContent = text;
    delete el.dataset.morphTo;
    el.classList.remove("morphing");
  }, Math.max(40, ms / 2));
}

/** Caption over a row of controls, so a cluster of toggles reads as one two-line field. */
export function group(caption: string, ...controls: { el: HTMLElement }[]): HTMLDivElement {
  const g = document.createElement("div");
  g.className = "group";
  const cap = document.createElement("span");
  cap.className = "cap";
  cap.textContent = caption;
  const row = document.createElement("div");
  row.className = "row";
  for (const c of controls) row.appendChild(c.el);
  g.append(cap, row);
  return g;
}
