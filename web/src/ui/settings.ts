import { displayName, type Device, usefulName } from "../core/types";
import { ColorField, pinFlyout, Select, Slider, Toggle, unpinFlyout } from "./ui";
import { AUDIO_DRIVES, DEFAULT_DREAM, DREAM_BOUNDS as B, EDGE_GLOWS, FOCUS_MODES, HERO_POS, MOSAIC_SIZES, SKY_CYCLES, THEME_CYCLES, type AudioDrive, type DreamAnim, type EdgeGlow, type FocusMode, type HeroPos, type MosaicSize, type ThemeCycle } from "../graph/scene";
import { BACKDROP_OPTIONS, cycleSkyPool, type BackdropKind } from "../graph/backdrop";
import { FLOOR_SHAPES, type FloorShape } from "../graph/floor";
import { themeById, toCssHex } from "../core/themes";
import { DEFAULT_FEED, FEED_LAYOUTS, FEED_SCOPES, type FeedConfig, type FeedLayout, type FeedScope } from "./feed";
import { liveCam } from "../camera/livecam";
import { type CamPolicy } from "../camera/want";
import { fillPluginFields } from "../plugins/plugin-ui";
import type { PluginView } from "../plugins/plugin";
import type { PluginField } from "../core/modes";
import type { PluginLook } from "../plugins/plugin";

const PANES: { id: string; label: string }[] = [
  { id: "appearance", label: "Appearance" },
  { id: "view", label: "This view" },
  { id: "graph", label: "Graph" },
  { id: "motion", label: "Motion" },
  { id: "camera", label: "Camera" },
  { id: "feed", label: "Feed" },
  { id: "privacy", label: "Privacy" },
  { id: "agent", label: "Agent" },
];

/**
 * Settings cog: a header button that opens a popover for user-defined filters and the controls that used to
 * sit in the header (show switches, privacy). The filters decide which devices appear in every view:
 *
 *   allow / block hostname patterns   glob (`*`, `?`) or plain substring, matched against names and IPs
 *   allow / block IP subnets          CIDR (`192.168.1.0/24`, `fd00::/16`), a bare IP, or a dotted prefix
 *
 * Block always wins. If any allow entry is set, a device must match at least one to be shown. Matching looks at
 * every name and every address a device carries (including the members folded in by "merge names").
 */

interface FilterField {
  key: string;
  label: string;
  placeholder: string;
  kind: "name" | "net";
}

const FIELDS: FilterField[] = [
  { key: "allowNames", label: "Allow host patterns", kind: "name", placeholder: "phone-*\n*.example.com\nspeaker" },
  { key: "blockNames", label: "Block host patterns", kind: "name", placeholder: "*.arpa\n*cdn*" },
  { key: "allowNets", label: "Allow IP subnets", kind: "net", placeholder: "192.168.1.0/24\nfd00::/16" },
  { key: "blockNets", label: "Block IP subnets", kind: "net", placeholder: "192.168.1.20\n10.0.0.0/8" },
];

const COG = `<svg viewBox="0 0 20 20" aria-hidden="true" width="16" height="16"><path fill="currentColor" d="M11.4 1.6a1 1 0 0 0-2.8 0l-.2 1.4a6.6 6.6 0 0 0-1.5.6L5.6 2.8a1 1 0 0 0-1.4 0L2.8 4.2a1 1 0 0 0 0 1.4l.9 1.2a6.6 6.6 0 0 0-.6 1.5l-1.5.2a1 1 0 0 0 0 2.8l1.4.2q.2.8.6 1.5l-.9 1.2a1 1 0 0 0 0 1.4l1.4 1.4a1 1 0 0 0 1.4 0l1.2-.9q.7.4 1.5.6l.2 1.5a1 1 0 0 0 2.8 0l.2-1.4q.8-.2 1.5-.6l1.2.9a1 1 0 0 0 1.4 0l1.4-1.4a1 1 0 0 0 0-1.4l-.9-1.2q.4-.7.6-1.5l1.5-.2a1 1 0 0 0 0-2.8l-1.4-.2a6.6 6.6 0 0 0-.6-1.5l.9-1.2a1 1 0 0 0 0-1.4l-1.4-1.4a1 1 0 0 0-1.4 0l-1.2.9a6.6 6.6 0 0 0-1.5-.6zM10 13a3 3 0 1 1 0-6 3 3 0 0 1 0 6z"/></svg>`;

export interface SettingsConfig {
  storePrefix: string;
  onChange: () => void;
  /** fired after a user edit is written to localStorage (filters, animation, live feed) */
  onPersist?: () => void;
}

export class Settings {
  readonly el: HTMLDivElement;
  private readonly btn: HTMLButtonElement;
  private readonly pop: HTMLDivElement;
  private readonly body: HTMLDivElement;
  private readonly badge: HTMLSpanElement;
  private readonly areas = new Map<string, HTMLTextAreaElement>();
  private test: (d: Device) => boolean = () => true;
  private activeCount = 0;
  private anim: DreamAnim;
  private feed: FeedConfig;
  private onAnimChange: (a: DreamAnim) => void = () => {};
  private onFeedChange: (c: FeedConfig) => void = () => {};
  private animUi: {
    follow: Toggle; cycle: Toggle; randomize: Toggle;
    skyOp: Slider; skyBr: Slider; skySp: Slider; skyEz: Slider;
    gridOp: Slider; gridBr: Slider; gridSize: Slider; gridColor: ColorField; bgColor: ColorField; bgOp: Slider;
    yaw: Slider; pitch: Slider; pitchCycle: Slider; zoom: Slider; zoomCycle: Slider; cadence: Slider;
    camAudio: Slider; camChange: Slider; camGaze: Slider; camInertia: Slider; camEase: Slider; camTheme: Toggle;
    sens: Slider;
    setSky: (v: BackdropKind) => void;
    setShape: (v: FloorShape) => void;
    setDrive: (v: AudioDrive) => void;
    setThemeCycle: (v: ThemeCycle) => void;
    setSkyCycle: (v: ThemeCycle) => void;
    setMosaic: (v: MosaicSize) => void;
    setHero: (v: HeroPos) => void;
    setFocus: (v: FocusMode) => void;
    setGlow: (v: EdgeGlow) => void;
    setMod: (key: "background" | "sky" | "floor" | "camera" | "nodes" | "skies", on: boolean) => void;
    skyPulse: Toggle; floorPulse: Toggle; bgPulse: Toggle;
    labels: Slider; shown: Slider; nodes: Slider; edges: Slider;
    glowAmt: Slider; glowSpeed: Slider;
  } | null = null;
  private feedUi: {
    on: Toggle; modulate: Toggle;
    setLayout: (v: FeedLayout) => void;
    setScope: (v: FeedScope) => void;
    dens: Slider;
  } | null = null;
  private readonly nav = document.createElement("nav");
  private readonly paneEls = new Map<string, HTMLDivElement>();
  private readonly navBtns = new Map<string, HTMLButtonElement>();
  private activePane = "graph";
  private viewHost: HTMLDivElement | null = null;
  private cameraUi: { policy: Select } | null = null;
  onCamPolicy?: (p: CamPolicy) => void;
  onPluginChange?: (id: string, values: Record<string, string>) => void;
  onClose?: () => void;

  constructor(private cfg: SettingsConfig) {
    this.el = document.createElement("div");
    this.el.className = "field settings";

    this.btn = document.createElement("button");
    this.btn.type = "button";
    this.btn.className = "cog";
    this.btn.title = "settings";
    this.btn.setAttribute("aria-label", "settings");
    this.btn.setAttribute("aria-haspopup", "dialog");
    this.btn.setAttribute("aria-expanded", "false");
    this.btn.innerHTML = COG;
    this.badge = document.createElement("span");
    this.badge.className = "badge";
    this.badge.title = "active filter rules";
    this.badge.setAttribute("aria-hidden", "true");
    this.btn.appendChild(this.badge);

    this.pop = document.createElement("div");
    this.pop.className = "settings-pop drawer";
    this.pop.setAttribute("role", "dialog");
    this.pop.setAttribute("aria-label", "settings");
    this.pop.hidden = true;

    this.nav.className = "s-nav";
    this.nav.setAttribute("aria-label", "settings sections");
    this.body = document.createElement("div");
    this.body.className = "sbody";
    for (const p of PANES) {
      const pane = document.createElement("div");
      pane.className = "spane";
      pane.dataset.pane = p.id;
      pane.hidden = p.id !== this.activePane;
      this.paneEls.set(p.id, pane);
      this.body.appendChild(pane);
      const b = document.createElement("button");
      b.type = "button";
      b.className = "s-nav-btn";
      b.textContent = p.label;
      b.setAttribute("aria-current", p.id === this.activePane ? "page" : "false");
      b.addEventListener("click", () => this.showPane(p.id));
      this.navBtns.set(p.id, b);
      this.nav.appendChild(b);
    }
    this.pop.append(this.nav, this.body);
    this.el.append(this.btn, this.pop);

    this.anim = loadAnim(cfg.storePrefix);
    this.feed = loadFeed(cfg.storePrefix);
    this.buildFilters();
    this.buildCamera();
    this.buildViewPane();
    document.body.classList.toggle("cam-off", liveCam.camPolicy === "off");

    this.btn.addEventListener("click", () => (this.isOpen ? this.close() : this.open()));
    this.pop.addEventListener("keydown", (e) => { if (e.key === "Escape") { this.close(); this.btn.focus(); } });
    this.rebuild();
  }

  private pane(id: string): HTMLDivElement {
    return this.paneEls.get(id) ?? this.body;
  }

  showPane(id: string): void {
    this.activePane = id;
    for (const [k, el] of this.paneEls) el.hidden = k !== id;
    for (const [k, b] of this.navBtns) b.setAttribute("aria-current", k === id ? "page" : "false");
  }

  private buildFilters(): void {
    const sec = document.createElement("section");
    sec.className = "sec";
    sec.innerHTML = `<div class="sec-title">Filters <button type="button" class="link clear" title="clear all filter patterns">clear</button></div>
      <div class="sec-hint">Which devices appear in every view. Block wins; if any allow list is set, only matches show.</div>`;
    const grid = document.createElement("div");
    grid.className = "fgrid";
    for (const f of FIELDS) {
      const wrap = document.createElement("label");
      wrap.className = `ffield ${f.kind === "net" ? "net" : "name"} ${f.key.startsWith("allow") ? "allow" : "block"}`;
      const cap = document.createElement("span");
      cap.className = "flabel";
      cap.textContent = f.label;
      const ta = document.createElement("textarea");
      ta.rows = 3;
      ta.spellcheck = false;
      ta.placeholder = f.placeholder;
      ta.value = localStorage.getItem(this.storeKey(f.key)) ?? "";
      ta.addEventListener("input", () => { localStorage.setItem(this.storeKey(f.key), ta.value); this.rebuild(); this.cfg.onChange(); this.cfg.onPersist?.(); });
      this.areas.set(f.key, ta);
      wrap.append(cap, ta);
      grid.appendChild(wrap);
    }
    sec.appendChild(grid);
    sec.querySelector(".clear")!.addEventListener("click", () => {
      for (const [key, ta] of this.areas) { ta.value = ""; localStorage.removeItem(this.storeKey(key)); }
      this.rebuild();
      this.cfg.onChange();
      this.cfg.onPersist?.();
    });
    this.pane("graph").appendChild(sec);
  }

  private buildViewPane(): void {
    const host = document.createElement("div");
    this.viewHost = host;
    this.pane("view").appendChild(host);
    this.bindView(null);
  }

  private buildCamera(): void {
    const sec = document.createElement("section");
    sec.className = "sec";
    sec.innerHTML = `<div class="sec-title">Camera</div>
      <div class="sec-hint">Off is the default and stops the webcam immediately. Auto only starts it for live sky, gaze steering, or live colour. Those Motion controls do nothing while Off.</div>`;
    const policy = new Select({
      caption: "camera",
      title: "Auto starts the webcam only for live sky, gaze, or live colour. Off never starts it.",
      options: [
        { value: "auto", label: "Auto", hint: "start only when a view needs it" },
        { value: "off", label: "Off", hint: "never start the webcam" },
      ],
      value: liveCam.camPolicy,
      onChange: (v) => this.setCamPolicy(v === "off" ? "off" : "auto"),
    });
    const row = document.createElement("div");
    row.className = "sec-controls";
    row.append(policy.el);
    sec.append(row);
    this.cameraUi = { policy };
    this.pane("camera").appendChild(sec);
  }

  setCamPolicy(p: CamPolicy): void {
    liveCam.setPolicy(p);
    if (this.cameraUi) this.cameraUi.policy.value = p;
    document.body.classList.toggle("cam-off", p === "off");
    this.onCamPolicy?.(p);
  }

  bindView(spec: PluginView | null, fields?: PluginField[], look?: PluginLook | null): void {
    const host = this.viewHost;
    if (!host) return;
    host.replaceChildren();
    if (look && Object.keys(look).length) {
      const pins = document.createElement("div");
      pins.className = "sec";
      const h = document.createElement("div");
      h.className = "sec-title";
      h.textContent = spec ? `Pinned by ${spec.name}` : "Pinned look";
      const p = document.createElement("div");
      p.className = "sec-hint";
      p.textContent = "This view overrides matching Motion / Appearance controls while selected.";
      const row = document.createElement("div");
      row.className = "pin-chips";
      for (const [k, v] of Object.entries(look)) {
        if (v === undefined) continue;
        const c = document.createElement("span");
        c.className = "pin-chip";
        c.textContent = `${k}: ${String(v)}`;
        row.appendChild(c);
      }
      pins.append(h, p, row);
      host.append(pins);
    }
    if (spec) {
      fillPluginFields(host, spec, fields ?? spec.config ?? [], (id, values) => {
        this.onPluginChange?.(id, values);
        this.cfg.onPersist?.();
      });
    } else if (!look) {
      const empty = document.createElement("div");
      empty.className = "sec";
      empty.innerHTML = `<div class="sec-title">This view</div><div class="sec-hint">Shipped views have no extra plugin fields. Pick a plugin view to configure it here.</div>`;
      host.append(empty);
    }
  }

  agentHost(): HTMLDivElement {
    return this.pane("agent");
  }

  /** Insert a section at the top of the popover (profile save / default). */
  prependSection(title: string, hint: string, controls: HTMLElement): void {
    const sec = document.createElement("section");
    sec.className = "sec";
    const h = document.createElement("div");
    h.className = "sec-title";
    h.textContent = title;
    const p = document.createElement("div");
    p.className = "sec-hint";
    p.textContent = hint;
    sec.append(h, p, controls);
    this.pane("appearance").appendChild(sec);
  }

  /** Graph pane (show filters live here when chrome is top). */
  get host(): HTMLDivElement { return this.pane("graph"); }
  get privacyHost(): HTMLDivElement { return this.pane("privacy"); }

  /** Add a titled section of controls (used to move the header's show / privacy toggles into the popover). */
  addSection(title: string, ...controls: { el: HTMLElement }[]): { el: HTMLElement; list: HTMLElement } {
    const sec = document.createElement("section");
    sec.className = "sec";
    const h = document.createElement("div");
    h.className = "sec-title";
    h.textContent = title;
    const list = document.createElement("div");
    list.className = "sec-controls";
    for (const c of controls) list.appendChild(c.el);
    sec.append(h, list);
    const pane = title.toLowerCase() === "privacy" ? "privacy" : title.toLowerCase() === "show" ? "graph" : "appearance";
    this.pane(pane).appendChild(sec);
    return { el: sec, list };
  }

  get animSettings(): DreamAnim { return this.anim; }
  get feedSettings(): FeedConfig { return this.feed; }

  /**
   * Dream-camera sliders. Call after Show so the popover reads Filters → Show → Animation → Privacy.
   * `dreamToggle` is the on/off switch (kept in sync with the header chip).
   */
  addAnimation(onChange: (a: DreamAnim) => void, dreamToggle: { el: HTMLElement }): void {
    this.onAnimChange = onChange;
    const sec = document.createElement("section");
    sec.className = "sec";
    sec.innerHTML = `<div class="sec-title">Animation
      <span class="sec-links">
        <button type="button" class="link shuffle" title="pick new orbit, pitch, and zoom within the slider ranges">randomize</button>
        <button type="button" class="link reset" title="restore default orbit, pitch, and zoom">reset</button>
      </span></div>
      <div class="sec-hint">Dream (header D): orbit, nod, and zoom toward activity. See docs → Views and motion.</div>`;

    const follow = new Toggle({
      label: "zoom to activity",
      title: "dolly in toward the highest-activity nodes, then ease back to the captured view",
      checked: this.anim.follow,
      onChange: (on) => { this.anim.follow = on; this.persistAnim(); },
    });
    const cycle = new Toggle({
      label: "cycle views",
      title: "while dreaming, walk Topology → Talkers → Services → Protocols → Layers → Watch on the cadence below",
      checked: this.anim.cycle,
      onChange: (on) => { this.anim.cycle = on; this.persistAnim(); },
    });
    const randomize = new Toggle({
      label: "randomize motion",
      title: "on each cadence tick, pick new orbit / pitch / zoom within the slider ranges",
      checked: this.anim.randomize,
      onChange: (on) => { this.anim.randomize = on; this.persistAnim(); },
    });
    const skyRow = document.createElement("div");
    skyRow.className = "skypick";
    skyRow.setAttribute("role", "radiogroup");
    skyRow.setAttribute("aria-label", "far-field sky");
    const skyBtns = new Map<BackdropKind, HTMLButtonElement>();
    const setSky = (v: BackdropKind) => {
      for (const [k, btn] of skyBtns) btn.setAttribute("aria-pressed", k === v ? "true" : "false");
    };
    for (const o of BACKDROP_OPTIONS) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "sky";
      b.textContent = o.label;
      b.title = o.hint;
      b.setAttribute("aria-pressed", o.value === this.anim.backdrop ? "true" : "false");
      b.addEventListener("click", () => { this.anim.backdrop = o.value; setSky(o.value); this.persistAnim(); });
      skyBtns.set(o.value, b);
      skyRow.appendChild(b);
    }
    const row = document.createElement("div");
    row.className = "sec-controls";
    row.append(dreamToggle.el, follow.el, cycle.el, randomize.el);
    const skyOp = new Slider({
      label: "opacity", title: "how solid the far-field sky is",
      min: 0, max: 100, step: 5, value: Math.round(this.anim.skyOpacity * 100),
      format: (v) => `${v}%`,
      onInput: (v) => { this.anim.skyOpacity = v / 100; this.persistAnim(); },
    });
    const skyBr = new Slider({
      label: "brightness", title: "how bright the sky reads against the fog",
      min: 0, max: 200, step: 5, value: Math.round(this.anim.skyBright * 100),
      format: (v) => `${v}%`,
      onInput: (v) => { this.anim.skyBright = v / 100; this.persistAnim(); },
    });
    const skySp = new Slider({
      label: "speed", title: "how fast the sky animates (the fractal drifts, stars wheel, code falls); 0 freezes it. The pulse adds up to 2.4× on top",
      min: Math.round(B.skySpeed.min * 100), max: Math.round(B.skySpeed.max * 100), step: 5, value: Math.round(this.anim.skySpeed * 100),
      format: (v) => `${(v / 100).toFixed(2)}×`,
      onInput: (v) => { this.anim.skySpeed = v / 100; this.persistAnim(); },
    });
    const skyEz = new Slider({
      label: "easing", title: "how gently the sky's speed follows the pulse and this slider: 0% snaps on every beat, 100% glides over a few seconds",
      min: 0, max: 100, step: 5, value: Math.round(this.anim.skyEase * 100),
      format: (v) => `${v}%`,
      onInput: (v) => { this.anim.skyEase = v / 100; this.persistAnim(); },
    });
    type ModKey = "background" | "sky" | "floor" | "camera" | "nodes" | "skies";
    let setMod: (key: ModKey, on: boolean) => void = () => {};
    const skyPulse = new Toggle({
      label: "pulse",
      title: "modulate sky opacity and brightness from the audio / traffic pulse",
      checked: this.anim.skyAudio,
      onChange: (on) => { this.anim.skyAudio = on; setMod("sky", on); this.persistAnim(); },
    });
    const skyWrap = lookBlock("sky", skyRow, skyOp, skyBr, skySp, skyEz);
    skyWrap.querySelector(".look-head")!.appendChild(skyPulse.el);
    const shapeRow = document.createElement("div");
    shapeRow.className = "skypick";
    shapeRow.setAttribute("role", "radiogroup");
    shapeRow.setAttribute("aria-label", "floor tile shape");
    const shapeBtns = new Map<FloorShape, HTMLButtonElement>();
    const setShape = (v: FloorShape) => {
      for (const [k, btn] of shapeBtns) btn.setAttribute("aria-pressed", k === v ? "true" : "false");
    };
    for (const o of FLOOR_SHAPES) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "sky";
      b.textContent = o.label;
      b.title = o.hint;
      b.setAttribute("aria-pressed", o.value === this.anim.gridShape ? "true" : "false");
      b.addEventListener("click", () => { this.anim.gridShape = o.value; setShape(o.value); this.persistAnim(); });
      shapeBtns.set(o.value, b);
      shapeRow.appendChild(b);
    }
    const gridColor = new ColorField({
      label: "color",
      title: "floor line colour; theme follows the active colour theme",
      value: this.anim.gridColor,
      themeHex: themeGridHex(),
      onInput: (v) => { this.anim.gridColor = v; this.persistAnim(); },
    });
    const gridSize = new Slider({
      label: "size", title: "world units on a side of each tile",
      min: B.gridSize.min, max: B.gridSize.max, step: B.gridSize.step, value: this.anim.gridSize,
      format: (v) => `${v}`,
      onInput: (v) => { this.anim.gridSize = v; this.persistAnim(); },
    });
    const gridOp = new Slider({
      label: "opacity", title: "how solid the floor grid is",
      min: 0, max: 100, step: 5, value: Math.round(this.anim.gridOpacity * 100),
      format: (v) => `${v}%`,
      onInput: (v) => { this.anim.gridOpacity = v / 100; this.persistAnim(); },
    });
    const gridBr = new Slider({
      label: "brightness", title: "how bright the floor grid lines are",
      min: 0, max: 200, step: 5, value: Math.round(this.anim.gridBright * 100),
      format: (v) => `${v}%`,
      onInput: (v) => { this.anim.gridBright = v / 100; this.persistAnim(); },
    });
    const floorPulse = new Toggle({
      label: "pulse",
      title: "modulate the floor grid from the audio / traffic pulse",
      checked: this.anim.gridAudio,
      onChange: (on) => { this.anim.gridAudio = on; setMod("floor", on); this.persistAnim(); },
    });
    const floorWrap = lookBlock("floor", shapeRow, gridColor, gridSize, gridOp, gridBr);
    floorWrap.querySelector(".look-head")!.appendChild(floorPulse.el);
    const bgColor = new ColorField({
      label: "color",
      title: "scene fill behind the sky; theme uses the active theme's defined background",
      value: this.anim.bgColor,
      themeHex: themeBgHex(),
      onInput: (v) => { this.anim.bgColor = v; this.persistAnim(); },
    });
    const bgOp = new Slider({
      label: "opacity",
      title: "how much of the fill stays; the rest fades to black on dark themes, white on light",
      min: 0, max: 100, step: 5, value: Math.round(this.anim.bgOpacity * 100),
      format: (v) => `${v}%`,
      onInput: (v) => { this.anim.bgOpacity = v / 100; this.persistAnim(); },
    });
    const bgPulse = new Toggle({
      label: "pulse",
      title: "modulate the scene fill (clear colour and fog) from the audio / traffic pulse",
      checked: this.anim.bgAudio,
      onChange: (on) => { this.anim.bgAudio = on; setMod("background", on); this.persistAnim(); },
    });
    const bgWrap = lookBlock("background", null, bgColor, bgOp);
    bgWrap.querySelector(".look-head")!.appendChild(bgPulse.el);

    const drive = chips(AUDIO_DRIVES, this.anim.audioDrive, (v) => { this.anim.audioDrive = v; this.persistAnim(); });
    const themeCycle = chips(THEME_CYCLES, this.anim.themeCycle, (v) => { this.anim.themeCycle = v; this.persistAnim(); });
    const skyCycle = chips(SKY_CYCLES, this.anim.skyCycle, (v) => {
      this.anim.skyCycle = v;
      setMod("skies", v !== "off");
      this.persistAnim();
    });
    const modItems: { key: ModKey; label: string; hint: string; get: () => boolean; set: (on: boolean) => void }[] = [
      { key: "background", label: "background", hint: "pulse the scene fill (clear colour and fog)", get: () => this.anim.bgAudio, set: (on) => { this.anim.bgAudio = on; } },
      { key: "sky", label: "sky", hint: "pulse far-field sky opacity and brightness", get: () => this.anim.skyAudio, set: (on) => { this.anim.skyAudio = on; } },
      { key: "skies", label: "skies", hint: "in dream, cycle fractal / space / matrix / live independently of theme (cadence or beat)", get: () => this.anim.skyCycle !== "off", set: (on) => { this.anim.skyCycle = on ? (this.anim.skyCycle === "off" ? "cadence" : this.anim.skyCycle) : "off"; } },
      { key: "floor", label: "floor", hint: "pulse the floor grid", get: () => this.anim.gridAudio, set: (on) => { this.anim.gridAudio = on; } },
      { key: "camera", label: "camera", hint: "FOV and dream orbit follow audio, how fast the graph/pulse is changing, and where you look (amounts under Camera)", get: () => this.anim.audioCamera, set: (on) => { this.anim.audioCamera = on; } },
      { key: "nodes", label: "nodes", hint: "bounce and glow graph nodes; fling harder on release", get: () => this.anim.audioNodes, set: (on) => { this.anim.audioNodes = on; } },
    ];
    const modBtns = new Map<string, HTMLButtonElement>();
    const modRow = document.createElement("div");
    modRow.className = "skypick";
    modRow.setAttribute("role", "group");
    modRow.setAttribute("aria-label", "audio modulate targets");
    setMod = (key: ModKey, on: boolean) => {
      modBtns.get(key)?.setAttribute("aria-pressed", on ? "true" : "false");
      if (key === "background") bgPulse.checked = on;
      if (key === "sky") skyPulse.checked = on;
      if (key === "floor") floorPulse.checked = on;
      if (key === "skies") skyCycle.set(this.anim.skyCycle);
    };
    for (const item of modItems) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "sky";
      b.textContent = item.label;
      b.title = item.hint;
      b.setAttribute("aria-pressed", item.get() ? "true" : "false");
      b.addEventListener("click", () => { item.set(!item.get()); setMod(item.key, item.get()); this.persistAnim(); });
      modBtns.set(item.key, b);
      modRow.appendChild(b);
    }
    const sens = new Slider({
      label: "sensitivity", title: "how hard the pulse drives whatever is modulated",
      min: 0, max: 200, step: 5, value: Math.round(this.anim.audioSens * 100),
      format: (v) => `${v}%`,
      onInput: (v) => { this.anim.audioSens = v / 100; this.persistAnim(); },
    });
    const mosaic = chips(MOSAIC_SIZES, this.anim.mosaic, (v) => { this.anim.mosaic = v; this.persistAnim(); });
    const hero = chips(HERO_POS, this.anim.hero, (v) => { this.anim.hero = v; this.persistAnim(); });
    const focus = chips(FOCUS_MODES, this.anim.focus, (v) => { this.anim.focus = v; this.persistAnim(); });
    const labels = new Slider({
      label: "labels", title: "label size and font-weight",
      min: 50, max: 200, step: 5, value: Math.round(this.anim.labelWeight * 100),
      format: (v) => `${v}%`,
      onInput: (v) => { this.anim.labelWeight = v / 100; this.persistAnim(); },
    });
    const shown = new Slider({
      label: "shown", title: "how many idle LAN and internet names stay on (this host, gateway, selection, and any node in a live unicast conversation — not discovery chatter — always keep a label)",
      min: B.labelCount.min, max: B.labelCount.max, step: B.labelCount.step, value: this.anim.labelCount,
      format: (v) => `${v}`,
      onInput: (v) => { this.anim.labelCount = v; this.persistAnim(); },
    });
    const nodes = new Slider({
      label: "nodes", title: "device sphere size",
      min: 40, max: 250, step: 5, value: Math.round(this.anim.nodeWeight * 100),
      format: (v) => `${v}%`,
      onInput: (v) => { this.anim.nodeWeight = v / 100; this.persistAnim(); },
    });
    const edges = new Slider({
      label: "edges", title: "link brightness and traffic-particle size",
      min: 30, max: 250, step: 5, value: Math.round(this.anim.edgeWeight * 100),
      format: (v) => `${v}%`,
      onInput: (v) => { this.anim.edgeWeight = v / 100; this.persistAnim(); },
    });
    const glow = chips(EDGE_GLOWS, this.anim.edgeGlow, (v) => { this.anim.edgeGlow = v; this.persistAnim(); });
    const glowAmt = new Slider({
      label: "glow", title: "how bright the traveling edge highlight is",
      min: 20, max: 200, step: 5, value: Math.round(this.anim.edgeGlowAmt * 100),
      format: (v) => `${v}%`,
      onInput: (v) => { this.anim.edgeGlowAmt = v / 100; this.persistAnim(); },
    });
    const glowSpeed = new Slider({
      label: "glow speed", title: "how fast the highlight travels along an active edge",
      min: 25, max: 300, step: 5, value: Math.round(this.anim.edgeGlowSpeed * 100),
      format: (v) => `${(v / 100).toFixed(2)}×`,
      onInput: (v) => { this.anim.edgeGlowSpeed = v / 100; this.persistAnim(); },
    });
    const audioBits = document.createElement("div");
    audioBits.className = "look-stack";
    audioBits.append(labeled("drive", drive.el), labeled("modulate", modRow), labeled("theme cycle", themeCycle.el), labeled("sky cycle", skyCycle.el), labeled("views", mosaic.el), labeled("hero", hero.el), labeled("focus", focus.el));
    const audioWrap = lookBlock("audio", audioBits, sens);
    const camAudio = new Slider({
      label: "audio", title: "how hard the audio / traffic pulse drives field of view, orbit speed, nod and zoom (0 = ignore the pulse)",
      min: 0, max: 200, step: 5, value: Math.round(this.anim.camAudio * 100),
      format: (v) => `${v}%`,
      onInput: (v) => { this.anim.camAudio = v / 100; this.persistAnim(); },
    });
    const camChange = new Slider({
      label: "change", title: "how hard detected velocity of change drives the camera: nodes moving in the layout, and how fast the pulse itself is rising",
      min: 0, max: 200, step: 5, value: Math.round(this.anim.camChange * 100),
      format: (v) => `${v}%`,
      onInput: (v) => { this.anim.camChange = v / 100; this.persistAnim(); },
    });
    const camGaze = new Slider({
      label: "gaze", title: "how hard webcam eye / face tracking steers look-at and orbit. Uses the same camera as the live sky; 0 leaves it off. Looking left or right pans; looking up or down nods.",
      min: 0, max: 200, step: 5, value: Math.round(this.anim.camGaze * 100),
      format: (v) => `${v}%`,
      onInput: (v) => { this.anim.camGaze = v / 100; this.persistAnim(); },
    });
    const camInertia = new Slider({
      label: "inertia", title: "how heavily the camera resists all motion: orbit, nod, zoom, gaze, framing, field of view, and the coast after a drag. 0% tracks immediately; 100% glides over a few seconds. Left-drag still lands where you release.",
      min: 0, max: 100, step: 5, value: Math.round(this.anim.camInertia * 100),
      format: (v) => `${v}%`,
      onInput: (v) => { this.anim.camInertia = v / 100; this.persistAnim(); },
    });
    const camEase = new Slider({
      label: "easing", title: "how gently all motion may change direction (camera orbit / nod / zoom / look-at, and graph nodes). 0% can reverse immediately; 100% has to slow through a stop before it turns.",
      min: 0, max: 100, step: 5, value: Math.round(this.anim.moveEase * 100),
      format: (v) => `${v}%`,
      onInput: (v) => { this.anim.moveEase = v / 100; this.persistAnim(); },
    });
    const camTheme = new Toggle({
      label: "live colour",
      title: "tint the current theme's accent, edges and roles toward the main colour in the webcam (same camera as the live sky). Greys, background and alerts stay; the selected theme id is unchanged.",
      checked: this.anim.camTheme,
      onChange: (on) => { this.anim.camTheme = on; this.persistAnim(); },
    });
    const camWrap = lookBlock("camera", null, camAudio, camChange, camGaze, camInertia, camEase);
    camWrap.classList.add("camera-look");
    camWrap.querySelector(".look-head")!.appendChild(camTheme.el);
    const graphBits = document.createElement("div");
    graphBits.className = "look-stack";
    graphBits.append(labeled("glow", glow.el));
    const graphWrap = lookBlock("graph", graphBits, labels, shown, nodes, edges, glowAmt, glowSpeed);

    const yaw = new Slider({
      label: "orbit", title: "seconds for one full revolution",
      min: B.yawPeriod.min, max: B.yawPeriod.max, step: B.yawPeriod.step, value: this.anim.yawPeriod,
      format: (v) => `${v}s / rev`,
      onInput: (v) => { this.anim.yawPeriod = v; this.persistAnim(); },
    });
    const pitch = new Slider({
      label: "pitch", title: "how far the camera nods, in degrees",
      min: B.pitchDeg.min, max: B.pitchDeg.max, step: B.pitchDeg.step, value: this.anim.pitchDeg,
      format: (v) => `${v}°`,
      onInput: (v) => { this.anim.pitchDeg = v; this.persistAnim(); },
    });
    const pitchCycle = new Slider({
      label: "pitch cycle", title: "seconds for one nod up and down",
      min: B.pitchPeriod.min, max: B.pitchPeriod.max, step: B.pitchPeriod.step, value: this.anim.pitchPeriod,
      format: (v) => `${v}s`,
      onInput: (v) => { this.anim.pitchPeriod = v; this.persistAnim(); },
    });
    const zoom = new Slider({
      label: "zoom in", title: "how much closer the camera dollies at the peak of the zoom pulse",
      min: 0, max: 70, step: 5, value: Math.round(this.anim.zoom * 100),
      format: (v) => `${v}%`,
      onInput: (v) => { this.anim.zoom = v / 100; this.persistAnim(); },
    });
    const zoomCycle = new Slider({
      label: "zoom cycle", title: "seconds for a full zoom in and back out",
      min: B.zoomPeriod.min, max: B.zoomPeriod.max, step: B.zoomPeriod.step, value: this.anim.zoomPeriod,
      format: (v) => `${v}s`,
      onInput: (v) => { this.anim.zoomPeriod = v; this.persistAnim(); },
    });
    const cadence = new Slider({
      label: "cadence", title: "seconds between view changes, motion reshuffles, and cadence theme / sky cycles",
      min: B.cyclePeriod.min, max: B.cyclePeriod.max, step: B.cyclePeriod.step, value: this.anim.cyclePeriod,
      format: (v) => `${v}s`,
      onInput: (v) => { this.anim.cyclePeriod = v; this.persistAnim(); },
    });
    const grid = document.createElement("div");
    grid.className = "agrid";
    grid.append(yaw.el, zoom.el, pitch.el, zoomCycle.el, pitchCycle.el, cadence.el);
    sec.append(row, bgWrap, skyWrap, floorWrap, audioWrap, graphWrap, grid);
    this.animUi = {
      follow, cycle, randomize, setSky, setShape,
      setDrive: drive.set, setThemeCycle: themeCycle.set, setSkyCycle: skyCycle.set, setMosaic: mosaic.set, setHero: hero.set, setFocus: focus.set, setGlow: glow.set, setMod,
      skyPulse, floorPulse, bgPulse,
      skyOp, skyBr, skySp, skyEz, gridOp, gridBr, gridSize, gridColor, bgColor, bgOp,
      yaw, pitch, pitchCycle, zoom, zoomCycle, cadence, camAudio, camChange, camGaze, camInertia, camEase, camTheme, sens,
      labels, shown, nodes, edges, glowAmt, glowSpeed,
    };
    sec.querySelector(".reset")!.addEventListener("click", () => {
      this.anim = { ...DEFAULT_DREAM };
      this.syncAnimUi();
      this.persistAnim();
    });
    sec.querySelector(".shuffle")!.addEventListener("click", () => this.shuffleAnim());
    this.pane("motion").appendChild(sec);
    this.pane("camera").appendChild(camWrap);
  }

  /** Live decoded-traffic overlay on the right of the graph. */
  addLiveFeed(onChange: (c: FeedConfig) => void): void {
    this.onFeedChange = onChange;
    const sec = document.createElement("section");
    sec.className = "sec";
    sec.innerHTML = `<div class="sec-title">Live feed</div>
      <div class="sec-hint">Decoded capture beside the graph. Header switch or F.</div>`;
    const on = new Toggle({
      label: "show overlay",
      title: "decoded packet ticker and/or protocol bars on the right of the scene (header feed switch or F)",
      checked: this.feed.on,
      onChange: (v) => this.setFeedOn(v),
    });
    const modulate = new Toggle({
      label: "modulate bars",
      title: "scale bar length with the audio / traffic pulse",
      checked: this.feed.modulate,
      onChange: (v) => { this.feed.modulate = v; this.persistFeed(); },
    });
    const layout = chips(FEED_LAYOUTS, this.feed.layout, (v) => { this.feed.layout = v; this.persistFeed(); });
    const scope = chips(FEED_SCOPES, this.feed.scope, (v) => { this.feed.scope = v; this.persistFeed(); });
    const dens = new Slider({
      label: "lines", title: "how many decoded lines to keep",
      min: 12, max: 80, step: 4, value: this.feed.density,
      format: (v) => `${v}`,
      onInput: (v) => { this.feed.density = v; this.persistFeed(); },
    });
    const row = document.createElement("div");
    row.className = "sec-controls";
    row.append(on.el, modulate.el);
    const bits = document.createElement("div");
    bits.className = "look-stack";
    bits.append(labeled("layout", layout.el), labeled("scope", scope.el));
    sec.append(row, lookBlock("overlay", bits, dens));
    this.feedUi = { on, modulate, setLayout: layout.set, setScope: scope.set, dens };
    this.pane("feed").appendChild(sec);
  }

  filterText(): { allowNames: string; blockNames: string; allowNets: string; blockNets: string } {
    return {
      allowNames: this.areas.get("allowNames")?.value ?? "",
      blockNames: this.areas.get("blockNames")?.value ?? "",
      allowNets: this.areas.get("allowNets")?.value ?? "",
      blockNets: this.areas.get("blockNets")?.value ?? "",
    };
  }

  setFilterText(f: { allowNames: string; blockNames: string; allowNets: string; blockNets: string }): void {
    for (const key of ["allowNames", "blockNames", "allowNets", "blockNets"] as const) {
      const ta = this.areas.get(key);
      if (!ta) continue;
      ta.value = f[key] ?? "";
      if (ta.value) localStorage.setItem(this.storeKey(key), ta.value);
      else localStorage.removeItem(this.storeKey(key));
    }
    this.rebuild();
    this.cfg.onChange();
  }

  applyAnim(a: DreamAnim): void {
    this.anim = { ...DEFAULT_DREAM, ...a };
    this.syncAnimUi();
    this.syncTheme();
    this.persistAnim();
  }

  /** Keep theme-follow swatches on the live theme (page chrome + default scene fill). */
  syncTheme(t = themeById(localStorage.getItem("zoto-viz.theme"))): void {
    this.animUi?.gridColor.setThemeHex(themeGridHex(t));
    this.animUi?.bgColor.setThemeHex(themeBgHex(t));
  }

  /** Show or hide the right-hand activity list. Syncs the cog toggle and persists. */
  setFeedOn(on: boolean): void {
    this.feed.on = on;
    if (this.feedUi) this.feedUi.on.checked = on;
    this.persistFeed();
  }

  applyFeed(c: FeedConfig): void {
    this.feed = { ...DEFAULT_FEED, ...c };
    const ui = this.feedUi;
    if (ui) {
      ui.on.checked = this.feed.on;
      ui.modulate.checked = this.feed.modulate;
      ui.setLayout(this.feed.layout);
      ui.setScope(this.feed.scope);
      ui.dens.value = this.feed.density;
    }
    this.persistFeed();
  }

  /** Next far-field sky in the dream pool (skips the current one; omits live if the camera is blocked). */
  cycleSky(): void {
    this.anim = { ...this.anim, backdrop: pickSky(this.anim.backdrop) };
    this.syncAnimUi();
    this.persistAnim();
  }

  /** Pick new motion values inside the slider ranges (keeps follow / cycle / randomize as they are). */
  shuffleAnim(): void {
    this.anim = {
      ...this.anim,
      yawPeriod: snap(B.yawPeriod),
      pitchDeg: snap(B.pitchDeg),
      pitchPeriod: snap(B.pitchPeriod),
      zoom: snap(B.zoom),
      zoomPeriod: snap(B.zoomPeriod),
      backdrop: this.anim.backdrop === "none" ? "none" : pickSky(this.anim.backdrop),
    };
    this.syncAnimUi();
    this.persistAnim();
  }

  private syncAnimUi(): void {
    const ui = this.animUi;
    if (!ui) return;
    const a = this.anim;
    ui.follow.checked = a.follow;
    ui.cycle.checked = a.cycle;
    ui.randomize.checked = a.randomize;
    ui.setSky(a.backdrop);
    ui.yaw.value = a.yawPeriod;
    ui.pitch.value = a.pitchDeg;
    ui.pitchCycle.value = a.pitchPeriod;
    ui.zoom.value = Math.round(a.zoom * 100);
    ui.zoomCycle.value = a.zoomPeriod;
    ui.cadence.value = a.cyclePeriod;
    ui.skyOp.value = Math.round(a.skyOpacity * 100);
    ui.skyBr.value = Math.round(a.skyBright * 100);
    ui.skySp.value = Math.round(a.skySpeed * 100);
    ui.skyEz.value = Math.round(a.skyEase * 100);
    ui.gridOp.value = Math.round(a.gridOpacity * 100);
    ui.gridBr.value = Math.round(a.gridBright * 100);
    ui.gridSize.value = a.gridSize;
    ui.gridColor.value = a.gridColor;
    ui.bgColor.value = a.bgColor;
    ui.bgOp.value = Math.round(a.bgOpacity * 100);
    ui.setShape(a.gridShape);
    ui.setDrive(a.audioDrive);
    ui.setThemeCycle(a.themeCycle);
    ui.setSkyCycle(a.skyCycle);
    ui.setMosaic(a.mosaic);
    ui.setHero(a.hero);
    ui.setFocus(a.focus);
    ui.setGlow(a.edgeGlow);
    ui.setMod("background", a.bgAudio);
    ui.setMod("sky", a.skyAudio);
    ui.setMod("skies", a.skyCycle !== "off");
    ui.setMod("floor", a.gridAudio);
    ui.setMod("camera", a.audioCamera);
    ui.setMod("nodes", a.audioNodes);
    ui.sens.value = Math.round(a.audioSens * 100);
    ui.camAudio.value = Math.round(a.camAudio * 100);
    ui.camChange.value = Math.round(a.camChange * 100);
    ui.camGaze.value = Math.round(a.camGaze * 100);
    ui.camInertia.value = Math.round(a.camInertia * 100);
    ui.camEase.value = Math.round(a.moveEase * 100);
    ui.camTheme.checked = a.camTheme;
    ui.labels.value = Math.round(a.labelWeight * 100);
    ui.shown.value = a.labelCount;
    ui.nodes.value = Math.round(a.nodeWeight * 100);
    ui.edges.value = Math.round(a.edgeWeight * 100);
    ui.glowAmt.value = Math.round(a.edgeGlowAmt * 100);
    ui.glowSpeed.value = Math.round(a.edgeGlowSpeed * 100);
  }

  private persistAnim(): void {
    const p = this.cfg.storePrefix;
    const a = this.anim;
    localStorage.setItem(`${p}.anim.yawPeriod`, String(a.yawPeriod));
    localStorage.setItem(`${p}.anim.pitchDeg`, String(a.pitchDeg));
    localStorage.setItem(`${p}.anim.pitchPeriod`, String(a.pitchPeriod));
    localStorage.setItem(`${p}.anim.zoom`, String(a.zoom));
    localStorage.setItem(`${p}.anim.zoomPeriod`, String(a.zoomPeriod));
    localStorage.setItem(`${p}.anim.follow`, a.follow ? "1" : "0");
    localStorage.setItem(`${p}.anim.cycle`, a.cycle ? "1" : "0");
    localStorage.setItem(`${p}.anim.cyclePeriod`, String(a.cyclePeriod));
    localStorage.setItem(`${p}.anim.randomize`, a.randomize ? "1" : "0");
    localStorage.setItem(`${p}.anim.backdrop`, a.backdrop);
    localStorage.setItem(`${p}.anim.skyOpacity`, String(a.skyOpacity));
    localStorage.setItem(`${p}.anim.skyBright`, String(a.skyBright));
    localStorage.setItem(`${p}.anim.skySpeed`, String(a.skySpeed));
    localStorage.setItem(`${p}.anim.skyEase`, String(a.skyEase));
    localStorage.setItem(`${p}.anim.skyAudio`, a.skyAudio ? "1" : "0");
    localStorage.setItem(`${p}.anim.bgAudio`, a.bgAudio ? "1" : "0");
    localStorage.setItem(`${p}.anim.bgColor`, a.bgColor);
    localStorage.setItem(`${p}.anim.bgOpacity`, String(a.bgOpacity));
    localStorage.setItem(`${p}.anim.gridOpacity`, String(a.gridOpacity));
    localStorage.setItem(`${p}.anim.gridBright`, String(a.gridBright));
    localStorage.setItem(`${p}.anim.gridAudio`, a.gridAudio ? "1" : "0");
    localStorage.setItem(`${p}.anim.gridColor`, a.gridColor);
    localStorage.setItem(`${p}.anim.gridSize`, String(a.gridSize));
    localStorage.setItem(`${p}.anim.gridShape`, a.gridShape);
    localStorage.setItem(`${p}.anim.audioSens`, String(a.audioSens));
    localStorage.setItem(`${p}.anim.audioDrive`, a.audioDrive);
    localStorage.setItem(`${p}.anim.audioCamera`, a.audioCamera ? "1" : "0");
    localStorage.setItem(`${p}.anim.camAudio`, String(a.camAudio));
    localStorage.setItem(`${p}.anim.camChange`, String(a.camChange));
    localStorage.setItem(`${p}.anim.camGaze`, String(a.camGaze));
    localStorage.setItem(`${p}.anim.camInertia`, String(a.camInertia));
    localStorage.setItem(`${p}.anim.moveEase`, String(a.moveEase));
    localStorage.setItem(`${p}.anim.camTheme`, a.camTheme ? "1" : "0");
    localStorage.setItem(`${p}.anim.audioNodes`, a.audioNodes ? "1" : "0");
    localStorage.setItem(`${p}.anim.themeCycle`, a.themeCycle);
    localStorage.setItem(`${p}.anim.skyCycle`, a.skyCycle);
    localStorage.setItem(`${p}.anim.labelWeight`, String(a.labelWeight));
    localStorage.setItem(`${p}.anim.labelCount`, String(a.labelCount));
    localStorage.setItem(`${p}.anim.nodeWeight`, String(a.nodeWeight));
    localStorage.setItem(`${p}.anim.edgeWeight`, String(a.edgeWeight));
    localStorage.setItem(`${p}.anim.edgeGlow`, a.edgeGlow);
    localStorage.setItem(`${p}.anim.edgeGlowAmt`, String(a.edgeGlowAmt));
    localStorage.setItem(`${p}.anim.edgeGlowSpeed`, String(a.edgeGlowSpeed));
    localStorage.setItem(`${p}.anim.mosaic`, a.mosaic);
    localStorage.setItem(`${p}.anim.hero`, a.hero);
    localStorage.setItem(`${p}.anim.focus`, a.focus);
    this.onAnimChange(a);
    this.cfg.onPersist?.();
  }

  private persistFeed(): void {
    const p = this.cfg.storePrefix;
    const c = this.feed;
    localStorage.setItem(`${p}.feed.on`, c.on ? "1" : "0");
    localStorage.setItem(`${p}.feed.layout`, c.layout);
    localStorage.setItem(`${p}.feed.scope`, c.scope);
    localStorage.setItem(`${p}.feed.density`, String(c.density));
    localStorage.setItem(`${p}.feed.modulate`, c.modulate ? "1" : "0");
    this.onFeedChange(c);
    this.cfg.onPersist?.();
  }

  private storeKey(key: string): string { return `${this.cfg.storePrefix}.filter.${key}`; }

  get isOpen(): boolean { return !this.pop.hidden; }

  open(): void {
    this.pop.hidden = false;
    this.el.classList.add("open");
    this.btn.setAttribute("aria-expanded", "true");
    const chrome = document.body.dataset.chrome;
    if (chrome === "left" || chrome === "right") {
      this.pop.classList.remove("right");
      pinFlyout(this.pop, this.btn, chrome);
    } else {
      unpinFlyout(this.pop, this.el);
      const r = this.pop.getBoundingClientRect();
      this.pop.classList.toggle("right", r.right > innerWidth - 8);
    }
    this.syncTheme();
    document.addEventListener("pointerdown", this.onDocDown, true);
  }

  close(): void {
    this.pop.hidden = true;
    this.el.classList.remove("open");
    this.btn.setAttribute("aria-expanded", "false");
    unpinFlyout(this.pop, this.el);
    document.removeEventListener("pointerdown", this.onDocDown, true);
    this.onClose?.();
  }

  private onDocDown = (e: PointerEvent) => {
    const t = e.target as Node;
    if (!this.el.contains(t) && !this.pop.contains(t)) this.close();
  };

  // ---- matching

  /** Whether a device passes the current allow/block filters. */
  matches(d: Device): boolean { return this.test(d); }

  private lines(key: string): string[] {
    return (this.areas.get(key)?.value ?? "").split(/[\n,]/).map((s) => s.trim()).filter(Boolean);
  }

  /** Recompile the matcher from the textareas. Called on every edit; cheap and keeps `matches` allocation-free. */
  private rebuild(): void {
    const allowNames = this.lines("allowNames").map(nameMatcher);
    const blockNames = this.lines("blockNames").map(nameMatcher);
    const allowNets = this.lines("allowNets").map(netMatcher);
    const blockNets = this.lines("blockNets").map(netMatcher);
    const hasAllow = allowNames.length > 0 || allowNets.length > 0;
    this.activeCount = allowNames.length + blockNames.length + allowNets.length + blockNets.length;
    this.badge.textContent = this.activeCount ? String(this.activeCount) : "";
    this.badge.classList.toggle("on", this.activeCount > 0);

    this.test = (d: Device): boolean => {
      const names = deviceNames(d);
      const addrs = deviceAddrs(d);
      if (blockNames.some((m) => names.some(m)) || blockNets.some((m) => addrs.some(m))) return false;
      if (!hasAllow) return true;
      return allowNames.some((m) => names.some(m)) || allowNets.some((m) => addrs.some(m));
    };
  }
}

function clampNum(raw: string | null, lo: number, hi: number, fallback: number): number {
  if (raw == null || raw === "") return fallback;
  const v = Number(raw);
  return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;
}

function lookBlock(caption: string, extra: HTMLElement | null, ...controls: { el: HTMLElement }[]): HTMLDivElement {
  const wrap = document.createElement("div");
  wrap.className = "lookwrap";
  const head = document.createElement("div");
  head.className = "look-head";
  const cap = document.createElement("span");
  cap.className = "cap";
  cap.textContent = caption;
  head.appendChild(cap);
  wrap.appendChild(head);
  if (extra) wrap.appendChild(extra);
  if (controls.length) {
    const g = document.createElement("div");
    g.className = "agrid";
    for (const c of controls) g.appendChild(c.el);
    wrap.appendChild(g);
  }
  return wrap;
}

function labeled(caption: string, ...kids: HTMLElement[]): HTMLDivElement {
  const wrap = document.createElement("div");
  wrap.className = "look-sub";
  const h = document.createElement("div");
  h.className = "subcap";
  h.textContent = caption;
  wrap.append(h, ...kids);
  return wrap;
}

function chips<T extends string>(
  opts: { value: T; label: string; hint: string }[],
  current: T,
  onPick: (v: T) => void,
): { el: HTMLDivElement; set: (v: T) => void } {
  const row = document.createElement("div");
  row.className = "skypick";
  row.setAttribute("role", "radiogroup");
  const btns = new Map<T, HTMLButtonElement>();
  const set = (v: T) => {
    for (const [k, btn] of btns) btn.setAttribute("aria-pressed", k === v ? "true" : "false");
  };
  for (const o of opts) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "sky";
    b.textContent = o.label;
    b.title = o.hint;
    b.setAttribute("aria-pressed", o.value === current ? "true" : "false");
    b.addEventListener("click", () => { onPick(o.value); set(o.value); });
    btns.set(o.value, b);
    row.appendChild(b);
  }
  return { el: row, set };
}

function snap(b: { min: number; max: number; step: number }): number {
  const n = Math.round((b.min + Math.random() * (b.max - b.min)) / b.step) * b.step;
  return Math.min(b.max, Math.max(b.min, Number(n.toFixed(4))));
}

function parseBackdrop(raw: string | null): BackdropKind {
  return BACKDROP_OPTIONS.some((o) => o.value === raw) ? (raw as BackdropKind) : DEFAULT_DREAM.backdrop;
}

function parseShape(raw: string | null): FloorShape {
  return FLOOR_SHAPES.some((o) => o.value === raw) ? (raw as FloorShape) : DEFAULT_DREAM.gridShape;
}

function parseGridColor(raw: string | null): string {
  if (!raw) return "";
  const m = raw.trim().match(/^#?([0-9a-fA-F]{6})$/);
  return m ? `#${m[1]!.toLowerCase()}` : "";
}

function themeGridHex(t = themeById(localStorage.getItem("zoto-viz.theme"))): string {
  return toCssHex(t.scene.gridMajor);
}

function themeBgHex(t = themeById(localStorage.getItem("zoto-viz.theme"))): string {
  return t.ui.bg;
}

function loadAnim(prefix: string): DreamAnim {
  const d = DEFAULT_DREAM;
  const n = (key: string, fallback: number, lo: number, hi: number) =>
    clampNum(localStorage.getItem(`${prefix}.anim.${key}`), lo, hi, fallback);
  // one-shot: put sky / floor / camera pulse back on after they shipped default-off
  if (localStorage.getItem(`${prefix}.anim.restoreAudio`) !== "1") {
    localStorage.setItem(`${prefix}.anim.skyAudio`, "1");
    localStorage.setItem(`${prefix}.anim.gridAudio`, "1");
    localStorage.setItem(`${prefix}.anim.audioCamera`, "1");
    localStorage.setItem(`${prefix}.anim.restoreAudio`, "1");
  }
  return {
    yawPeriod: n("yawPeriod", d.yawPeriod, B.yawPeriod.min, B.yawPeriod.max),
    pitchDeg: n("pitchDeg", d.pitchDeg, B.pitchDeg.min, B.pitchDeg.max),
    pitchPeriod: n("pitchPeriod", d.pitchPeriod, B.pitchPeriod.min, B.pitchPeriod.max),
    zoom: n("zoom", d.zoom, B.zoom.min, B.zoom.max),
    zoomPeriod: n("zoomPeriod", d.zoomPeriod, B.zoomPeriod.min, B.zoomPeriod.max),
    follow: localStorage.getItem(`${prefix}.anim.follow`) !== "0",
    cycle: localStorage.getItem(`${prefix}.anim.cycle`) === "1",
    cyclePeriod: n("cyclePeriod", d.cyclePeriod, B.cyclePeriod.min, B.cyclePeriod.max),
    randomize: localStorage.getItem(`${prefix}.anim.randomize`) === "1",
    backdrop: parseBackdrop(localStorage.getItem(`${prefix}.anim.backdrop`)),
    skyOpacity: n("skyOpacity", d.skyOpacity, B.opacity.min, B.opacity.max),
    skyBright: n("skyBright", d.skyBright, B.bright.min, B.bright.max),
    skySpeed: n("skySpeed", d.skySpeed, B.skySpeed.min, B.skySpeed.max),
    skyEase: n("skyEase", d.skyEase, B.skyEase.min, B.skyEase.max),
    skyAudio: localStorage.getItem(`${prefix}.anim.skyAudio`) !== "0",
    bgAudio: localStorage.getItem(`${prefix}.anim.bgAudio`) === "1",
    gridOpacity: n("gridOpacity", d.gridOpacity, B.opacity.min, B.opacity.max),
    gridBright: n("gridBright", d.gridBright, B.bright.min, B.bright.max),
    gridAudio: localStorage.getItem(`${prefix}.anim.gridAudio`) !== "0",
    gridColor: parseGridColor(localStorage.getItem(`${prefix}.anim.gridColor`)),
    bgColor: parseGridColor(localStorage.getItem(`${prefix}.anim.bgColor`)),
    bgOpacity: n("bgOpacity", d.bgOpacity, B.opacity.min, B.opacity.max),
    gridSize: n("gridSize", d.gridSize, B.gridSize.min, B.gridSize.max),
    gridShape: parseShape(localStorage.getItem(`${prefix}.anim.gridShape`)),
    audioSens: n("audioSens", d.audioSens, B.audioSens.min, B.audioSens.max),
    audioDrive: parseDrive(localStorage.getItem(`${prefix}.anim.audioDrive`)),
    audioCamera: localStorage.getItem(`${prefix}.anim.audioCamera`) !== "0",
    camAudio: n("camAudio", d.camAudio, B.camDrive.min, B.camDrive.max),
    camChange: n("camChange", d.camChange, B.camDrive.min, B.camDrive.max),
    camGaze: n("camGaze", d.camGaze, B.camDrive.min, B.camDrive.max),
    camInertia: n("camInertia", d.camInertia, B.camInertia.min, B.camInertia.max),
    moveEase: n("moveEase", d.moveEase, B.moveEase.min, B.moveEase.max),
    camTheme: localStorage.getItem(`${prefix}.anim.camTheme`) === "1",
    audioNodes: localStorage.getItem(`${prefix}.anim.audioNodes`) === "1",
    themeCycle: parseThemeCycle(localStorage.getItem(`${prefix}.anim.themeCycle`)),
    skyCycle: parseThemeCycle(localStorage.getItem(`${prefix}.anim.skyCycle`)),
    labelWeight: n("labelWeight", d.labelWeight, B.labelWeight.min, B.labelWeight.max),
    labelCount: n("labelCount", d.labelCount, B.labelCount.min, B.labelCount.max),
    nodeWeight: n("nodeWeight", d.nodeWeight, B.nodeWeight.min, B.nodeWeight.max),
    edgeWeight: n("edgeWeight", d.edgeWeight, B.edgeWeight.min, B.edgeWeight.max),
    edgeGlow: parseGlow(localStorage.getItem(`${prefix}.anim.edgeGlow`)),
    edgeGlowAmt: n("edgeGlowAmt", d.edgeGlowAmt, B.edgeGlowAmt.min, B.edgeGlowAmt.max),
    edgeGlowSpeed: n("edgeGlowSpeed", d.edgeGlowSpeed, B.edgeGlowSpeed.min, B.edgeGlowSpeed.max),
    mosaic: parseMosaic(localStorage.getItem(`${prefix}.anim.mosaic`)),
    hero: parseHero(localStorage.getItem(`${prefix}.anim.hero`)),
    focus: parseFocus(localStorage.getItem(`${prefix}.anim.focus`)),
  };
}

function parseGlow(raw: string | null): EdgeGlow {
  return EDGE_GLOWS.some((o) => o.value === raw) ? (raw as EdgeGlow) : DEFAULT_DREAM.edgeGlow;
}

function parseMosaic(raw: string | null): MosaicSize {
  return MOSAIC_SIZES.some((o) => o.value === raw) ? (raw as MosaicSize) : DEFAULT_DREAM.mosaic;
}

function parseHero(raw: string | null): HeroPos {
  return HERO_POS.some((o) => o.value === raw) ? (raw as HeroPos) : DEFAULT_DREAM.hero;
}

function parseFocus(raw: string | null): FocusMode {
  return FOCUS_MODES.some((o) => o.value === raw) ? (raw as FocusMode) : DEFAULT_DREAM.focus;
}

function parseDrive(raw: string | null): AudioDrive {
  return AUDIO_DRIVES.some((o) => o.value === raw) ? (raw as AudioDrive) : DEFAULT_DREAM.audioDrive;
}

function parseThemeCycle(raw: string | null): ThemeCycle {
  return THEME_CYCLES.some((o) => o.value === raw) ? (raw as ThemeCycle) : DEFAULT_DREAM.themeCycle;
}

function pickSky(current: BackdropKind): BackdropKind {
  const pool = cycleSkyPool().filter((k) => k !== current);
  const pick = pool.length ? pool : cycleSkyPool();
  return pick[Math.floor(Math.random() * pick.length)] ?? current;
}

function loadFeed(prefix: string): FeedConfig {
  const d = DEFAULT_FEED;
  const n = (key: string, fallback: number, lo: number, hi: number) =>
    clampNum(localStorage.getItem(`${prefix}.feed.${key}`), lo, hi, fallback);
  const layout = localStorage.getItem(`${prefix}.feed.layout`);
  const scope = localStorage.getItem(`${prefix}.feed.scope`);
  return {
    on: localStorage.getItem(`${prefix}.feed.on`) !== "0",
    layout: FEED_LAYOUTS.some((o) => o.value === layout) ? (layout as FeedLayout) : d.layout,
    scope: FEED_SCOPES.some((o) => o.value === scope) ? (scope as FeedScope) : d.scope,
    density: n("density", d.density, 12, 80),
    modulate: localStorage.getItem(`${prefix}.feed.modulate`) !== "0",
  };
}

// -------------------------------------------------------------------- matchers

/**
 * Compile a free-text pattern list (one per line or comma) into a test over a device, or over a bare address when
 * the device is unknown. Each entry is a CIDR / bare IP when it parses as one, otherwise a name glob / substring
 * that is also tried as a textual prefix of the addresses (so `192.168.1.` works). Any entry matching is a match;
 * an empty pattern matches nothing. Used by NetPong's "matcher" target.
 */
export function compileMatcher(text: string): (d: Device | undefined, ip: string) => boolean {
  const entries = text.split(/[\n,]/).map((s) => s.trim()).filter(Boolean);
  if (!entries.length) return () => false;
  const nets = entries.filter((e) => parseNet(e)).map(netMatcher);
  const names = entries.filter((e) => !parseNet(e)).map(nameMatcher);
  const prefixes = entries.filter((e) => !parseNet(e)).map((e) => e.toLowerCase());
  return (d, ip) => {
    const addrs = d ? deviceAddrs(d) : [ip];
    if (nets.some((m) => addrs.some(m))) return true;
    if (prefixes.some((p) => addrs.some((a) => a.toLowerCase().startsWith(p)))) return true;
    const ns = d ? deviceNames(d) : [ip.toLowerCase()];
    return names.some((m) => ns.some(m));
  };
}

function deviceNames(d: Device): string[] {
  const out = new Set<string>();
  out.add(displayName(d).toLowerCase());
  for (const n of d.names ?? []) if (usefulName(n)) out.add(n.toLowerCase());
  for (const n of d.hostnames ?? []) if (usefulName(n)) out.add(n.toLowerCase());
  if (d.mdns_name && usefulName(d.mdns_name)) out.add(d.mdns_name.toLowerCase());
  if (d.vendor) out.add(d.vendor.toLowerCase());
  return [...out];
}

function deviceAddrs(d: Device): string[] {
  return [d.ip, ...(d.aliases ?? [])];
}

/** A glob (`*`, `?`) matches the whole string; anything else matches as a case-insensitive substring. */
function nameMatcher(pattern: string): (name: string) => boolean {
  const p = pattern.toLowerCase();
  if (p.includes("*") || p.includes("?")) {
    const re = new RegExp("^" + p.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".") + "$");
    return (name) => re.test(name);
  }
  return (name) => name.includes(p);
}

interface Net { v6: boolean; base: bigint; mask: bigint }

/** CIDR / bare-IP matcher, with a dotted-prefix string fallback (`192.168.1.` or `192.168.1`). */
function netMatcher(pattern: string): (ip: string) => boolean {
  const net = parseNet(pattern);
  if (net) {
    return (ip) => {
      const a = ipToBig(ip);
      return a !== null && a.v6 === net.v6 && (a.value & net.mask) === net.base;
    };
  }
  // not a valid CIDR: treat as a literal prefix of the textual address (handy for "192.168.1.")
  const p = pattern.toLowerCase();
  return (ip) => ip.toLowerCase().startsWith(p);
}

function parseNet(s: string): Net | null {
  const slash = s.indexOf("/");
  const addr = slash < 0 ? s : s.slice(0, slash);
  const parsed = ipToBig(addr);
  if (!parsed) return null;
  const maxBits = parsed.v6 ? 128 : 32;
  let bits = maxBits;
  if (slash >= 0) {
    bits = Number(s.slice(slash + 1));
    if (!Number.isInteger(bits) || bits < 0 || bits > maxBits) return null;
  }
  const all = (1n << BigInt(maxBits)) - 1n;
  const mask = bits === 0 ? 0n : (all << BigInt(maxBits - bits)) & all;
  return { v6: parsed.v6, base: parsed.value & mask, mask };
}

/** Parse a full IPv4 or IPv6 address to a big integer; returns null for partials so they hit the prefix fallback. */
function ipToBig(addr: string): { v6: boolean; value: bigint } | null {
  if (addr.includes(":")) {
    const v = ipv6ToBig(addr);
    return v === null ? null : { v6: true, value: v };
  }
  const parts = addr.split(".");
  if (parts.length !== 4) return null;
  let v = 0n;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const n = Number(p);
    if (n > 255) return null;
    v = (v << 8n) | BigInt(n);
  }
  return { v6: false, value: v };
}

function ipv6ToBig(addr: string): bigint | null {
  const zone = addr.indexOf("%"); // strip a scope id like fe80::1%wlan0
  if (zone >= 0) addr = addr.slice(0, zone);
  const halves = addr.split("::");
  if (halves.length > 2) return null;
  const expand = (s: string) => (s ? s.split(":") : []);
  const head = expand(halves[0]);
  const tail = halves.length === 2 ? expand(halves[1]) : [];
  const missing = 8 - (head.length + tail.length);
  if (halves.length === 1 ? head.length !== 8 : missing < 0) return null;
  const groups = halves.length === 2 ? [...head, ...Array(missing).fill("0"), ...tail] : head;
  let v = 0n;
  for (const g of groups) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return null;
    v = (v << 16n) | BigInt(parseInt(g, 16));
  }
  return v;
}
