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
}

export interface SelectConfig {
  caption: string;
  options: SelectOption[];
  value?: string;
  title?: string;
  id?: string;
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
  private readonly menuId: string;
  onChange: (value: string, opt: SelectOption) => void;

  constructor(cfg: SelectConfig) {
    this.onChange = cfg.onChange ?? (() => {});
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
    this.menu.addEventListener("pointerdown", (e) => e.preventDefault()); // keep focus on the button
    this.menu.addEventListener("pointermove", (e) => {
      const li = (e.target as HTMLElement).closest("li");
      if (li) this.setActive(this.items.indexOf(li as HTMLLIElement));
    });
    this.menu.addEventListener("click", (e) => {
      const li = (e.target as HTMLElement).closest("li");
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
    this.menu.innerHTML = "";
    this.items = options.map((o, i) => {
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
      return li;
    });
    if (this.current) this.value = this.current;
  }

  get isOpen(): boolean { return !this.menu.hidden; }

  open(): void {
    if (this.isOpen) return;
    if (openSelect && openSelect !== this) openSelect.close();
    openSelect = this;
    this.menu.hidden = false;
    this.el.classList.add("open");
    this.btn.setAttribute("aria-expanded", "true");
    this.setActive(Math.max(0, this.options.findIndex((o) => o.value === this.current)));
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
    const opt = this.options[i];
    this.close();
    if (!opt || opt.value === this.current) return;
    this.value = opt.value;
    this.onChange(opt.value, opt);
  }

  private onButtonKey(e: KeyboardEvent): void {
    const n = this.options.length;
    if (!this.isOpen) {
      if (["Enter", " ", "ArrowDown", "ArrowUp"].includes(e.key)) { e.preventDefault(); this.open(); }
      return;
    }
    switch (e.key) {
      case "ArrowDown": e.preventDefault(); this.setActive((this.active + 1) % n); break;
      case "ArrowUp": e.preventDefault(); this.setActive((this.active - 1 + n) % n); break;
      case "Home": e.preventDefault(); this.setActive(0); break;
      case "End": e.preventDefault(); this.setActive(n - 1); break;
      case "Enter": case " ": e.preventDefault(); this.pick(this.active); break;
      case "Escape": e.preventDefault(); this.close(); break;
      case "Tab": this.close(); break;
    }
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
