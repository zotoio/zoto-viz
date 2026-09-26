import { apiFetch } from "../core/http";
import type { SourceKind, SourceLive, SourceRow } from "../core/sources";
import { displayName, type Device, usefulName } from "../core/types";
import { applyFloatRect, bindFloatPanel, readFloatRect } from "./float-drag";
import { ColorField, GroupedChips, pinFlyout, Slider, Toggle, unpinFlyout } from "./ui";
import { MAGNET_FIELDS } from "../graph/physics";
import type { PluginField } from "../core/modes";
import { assignTiles, equalize, leafIds, nextPaneTiles, parseMosaicNode, parseMosaicTiles } from "../graph/mosaic-layout";
import { AUDIO_DRIVES, DEFAULT_DREAM, DREAM_BOUNDS as B, EDGE_GLOWS, FABRIC_OPTIONS, FOCUS_MODES, GRAPH_LAYOUT_OPTIONS, GRAPH_LINK_OPTIONS, GRAPH_SPACE_OPTIONS, HERO_POS, MOSAIC_SIZES, SKY_CYCLES, THEME_CYCLES, type AudioDrive, type DreamAnim, type EdgeGlow, type FabricKind, type FocusMode, type GraphLayout, type GraphLinks, type GraphSpace, type HeroPos, type MosaicSize, type ThemeCycle } from "../graph/scene";
import { BACKDROP_OPTIONS, SKY_GROUP_TABS, cycleSkyPool, type BackdropKind } from "../graph/backdrop";
import { invalidateSkyRecipe } from "../graph/sky-ai";
import { FLOOR_SHAPES, type FloorShape } from "../graph/floor";
import { themeById, toCssHex } from "../core/themes";
import { DEFAULT_FEED, FEED_LAYOUTS, FEED_SCOPES, FEED_SOURCES, migrateFeedChatSplit, type FeedConfig, type FeedLayout, type FeedScope, type FeedSource } from "./feed";
import { DEFAULT_CHAT, type ChatConfig } from "./chat";
import { liveCam } from "../camera/livecam";
import { type CamPolicy } from "../camera/want";
import { clearMediaDismiss, dropMediaAsk } from "./media-ask";
import { liveMic, type MicPolicy } from "../audio/want";
import { liveSound } from "../audio/sound";
import { fillPluginFields } from "../plugins/plugin-ui";
import type { PluginLook, PluginView } from "../plugins/plugin";
import type { SdmDevice } from "../plugins/nest-cams-look";
import { viewSelectOptions, fillViewSelect } from "../plugins/plugin";
import { pluginViewKnobs } from "../plugins/plugin-visualisation";
import {
  DEFAULT_DICE, DICE_INCLUDE_META, DICE_PERIOD, normalizeDice, type DiceConfig, type DiceIncludeKey, type DiceMosaicMax,
} from "../core/shuffle";
import { guardReadableAnim } from "../graph/readable";
import {
  AUTH_SETUPS,
  renderAuthSetup,
  sourceAuthKind,
  sourceAuthReady,
  type AuthSetup,
} from "../core/auth-setup";
import { makeViewCogButton, VIEW_COG_SVG } from "./view-cog";

const PANES: { id: string; label: string }[] = [
  { id: "appearance", label: "Appearance" },
  { id: "view", label: "This view" },
  { id: "graph", label: "Graph" },
  { id: "physics", label: "Physics" },
  { id: "motion", label: "Motion" },
  { id: "dice", label: "Dice" },
  { id: "camera", label: "Camera" },
  { id: "audio", label: "Audio" },
  { id: "feed", label: "Feed" },
  { id: "chat", label: "Chat" },
  { id: "sources", label: "Sources" },
  { id: "privacy", label: "Privacy" },
  { id: "agent", label: "Agent" },
];

/**
 * Settings cog: a header button that opens a popover for user-defined filters and the controls that used to
 * sit in the header (show switches, privacy). Host and subnet filters live on Privacy and decide which
 * devices appear in every view:
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

export { makeViewCogButton } from "./view-cog";

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

function packLayerNames(spec: PluginView): string[] {
  const layers: string[] = [];
  if (spec.has_datasource) layers.push("datasource");
  if (spec.has_backend || spec.service) layers.push("backend");
  if (spec.has_frontend || spec.has_sky || spec.has_sky_shader) layers.push("frontend");
  layers.push("view");
  return layers;
}

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
  private chat: ChatConfig;
  private onAnimChange: (a: DreamAnim) => void = () => {};
  private onFeedChange: (c: FeedConfig) => void = () => {};
  private onChatChange: (c: ChatConfig) => void = () => {};
  private animUi: {
    follow: Toggle; cycle: Toggle; randomize: Toggle;
    skyOp: Slider; skyBr: Slider; skySp: Slider; skyEz: Slider; skyAi: Slider;
    gridOp: Slider; gridBr: Slider; gridSize: Slider; gridFollow: Slider; gridColor: ColorField; bgColor: ColorField; bgOp: Slider;
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
    syncTiles: () => void;
    sharedTheme: Toggle;
    setFocus: (v: FocusMode) => void;
    setGlow: (v: EdgeGlow) => void;
    setFabric: (v: FabricKind) => void;
    setSpace: (v: GraphSpace) => void;
    setLayout: (v: GraphLayout) => void;
    setLinks: (v: GraphLinks) => void;
    setMod: (key: "background" | "sky" | "floor" | "camera" | "nodes" | "skies" | "physics" | "particles", on: boolean) => void;
    skyPulse: Toggle; floorPulse: Toggle; bgPulse: Toggle;
    labels: Slider; shown: Slider; nodes: Slider; edges: Slider;
    glowAmt: Slider; glowSpeed: Slider;
    autoTune: Toggle;
    partAmt: Slider; partBusy: Slider; partQuiet: Slider; partPeak: Slider; partCap: Slider; partSpeed: Slider; partSize: Slider;
    magnetSelf: Slider; magnetGateway: Slider; magnetLan: Slider; magnetLocal: Slider; magnetInternet: Slider; magnetMulticast: Slider;
    magnetCross: Slider; magnetRange: Slider; gravity: Slider; swirl: Slider; chargeAmt: Slider; spring: Slider; linkSpan: Slider;
    drag: Slider; centerPull: Slider; stringAmt: Slider;
    physPulse: Toggle; partPulse: Toggle;
  } | null = null;
  private feedUi: {
    on: Toggle; modulate: Toggle;
    setLayout: (v: FeedLayout) => void;
    setScope: (v: FeedScope) => void;
    dens: Slider;
    size: Slider;
  } | null = null;
  private chatUi: { on: Toggle; size: Slider } | null = null;
  private sourcesUi: { list: HTMLDivElement; include: Toggle; instances: HTMLDivElement; auth: HTMLDivElement } | null = null;
  private readonly nav = document.createElement("nav");
  private readonly paneEls = new Map<string, HTMLDivElement>();
  private readonly navBtns = new Map<string, HTMLButtonElement>();
  private activePane = "graph";
  private viewHost: HTMLDivElement | null = null;
  private viewMosaicSec: HTMLElement | null = null;
  private viewCog: HTMLButtonElement | null = null;
  private viewFocusId = "";
  private nestDevices: SdmDevice[] = [];
  private nestDeviceKey = "";
  private viewBind: {
    spec: PluginView | null;
    fields?: PluginField[];
    look?: PluginLook | null;
    extras?: HTMLElement[];
  } | null = null;
  private deviceUi: { cam: Toggle; mic: Toggle; sound: Toggle } | null = null;
  private audioUi: { src: HTMLSpanElement; level: HTMLElement; bass: HTMLElement } | null = null;
  private pulseNow: () => { level: number; bass: number; listening?: boolean } = () => ({ level: 0, bass: 0 });
  private meterRaf = 0;
  private dice: DiceConfig;
  private diceUi: {
    on: Toggle;
    period: Slider;
    include: Record<DiceIncludeKey, Toggle>;
    cycle: Toggle;
    labels: Slider;
    sparks: Slider;
    sparkPeak: Slider;
    dens: Slider;
    nodeTop: Slider;
    setMosaicMax: (v: DiceMosaicMax) => void;
  } | null = null;
  onCamPolicy?: (p: CamPolicy) => void;
  onMicPolicy?: (p: MicPolicy) => void;
  onSoundPolicy?: (on: boolean) => void;
  onPluginChange?: (id: string, values: Record<string, string>) => void;
  /** Live wall: swap one tile's view (returns false when the pick could not be applied). */
  onMosaicPanePick?: (fromId: string, toId: string) => boolean;
  onInstancesChange?: () => void;
  onClose?: () => void;
  onDice?: () => void;
  onDiceChange?: (c: DiceConfig) => void;

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
    this.btn.innerHTML = VIEW_COG_SVG;
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
    const handle = document.createElement("div");
    handle.textContent = "settings";
    this.pop.append(handle, this.nav, this.body);
    this.el.append(this.btn, this.pop);
    bindFloatPanel(this.pop, handle, "settings", { pin: () => this.pinFloat(), min: { w: 360, h: 280 } });

    this.anim = loadAnim(cfg.storePrefix);
    this.feed = loadFeed(cfg.storePrefix);
    this.chat = loadChat(cfg.storePrefix);
    const split = migrateFeedChatSplit(cfg.storePrefix);
    if (split.source) this.feed.source = split.source;
    if (split.chatOn) this.chat.on = true;
    this.dice = loadDice(cfg.storePrefix);
    this.buildDevices();
    this.buildFilters();
    this.buildViewPane();
    this.buildDice();
    this.buildSources();
    document.body.classList.toggle("cam-off", liveCam.camPolicy === "off");
    document.body.classList.toggle("mic-off", liveMic.micPolicy === "off");
    document.body.classList.toggle("sound-off", !liveSound.soundOn);

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
    this.syncViewCog();
  }

  /** Cog next to the view selector: opens This view (plugin options, config, arcade knobs). */
  attachViewCog(host: HTMLElement, onOpen?: () => void): HTMLButtonElement {
    const btn = makeViewCogButton({
      onClick: () => {
        if (this.isOpen && this.activePane === "view" && !this.viewFocusId) this.close();
        else {
          onOpen?.();
          this.openView();
        }
      },
    });
    host.appendChild(btn);
    this.viewCog = btn;
    return btn;
  }

  /** This view for the wall, or for one mosaic / camera pane when `focusId` is set. */
  openView(focusId?: string): void {
    const want = focusId ?? "";
    if (this.isOpen && this.activePane === "view" && this.viewFocusId === want) {
      this.close();
      return;
    }
    this.viewFocusId = want;
    this.open("view");
    this.animUi?.syncTiles();
  }

  get viewFocus(): string { return this.viewFocusId; }

  private syncViewCog(): void {
    const on = this.isOpen && this.activePane === "view";
    this.viewCog?.setAttribute("aria-expanded", on && !this.viewFocusId ? "true" : "false");
    for (const el of document.querySelectorAll<HTMLElement>(".mosaic-pane-cog")) {
      el.setAttribute("aria-expanded", on && el.dataset.pane === this.viewFocusId ? "true" : "false");
    }
  }

  private buildFilters(): void {
    const sec = document.createElement("section");
    sec.className = "sec";
    sec.innerHTML = `<div class="sec-title">Network detail <button type="button" class="link clear" title="clear all filter patterns">clear</button></div>
      <div class="sec-hint">Which hosts and subnets appear in every view. Block wins; if any allow list is set, only matches show.</div>`;
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
    this.pane("privacy").appendChild(sec);
  }

  private buildDevices(): void {
    const sec = document.createElement("section");
    sec.className = "sec";
    sec.innerHTML = `<div class="sec-title">Devices</div>
      <div class="sec-hint">Cam and mic are operator-only — Off stops them so the OS light goes out. AI and dice cannot change those. Sound is speaker output (plugin SFX, arcade, spoken replies) and starts off. Header cam / mic / sound are the same switches.</div>`;
    const cam = new Toggle({
      label: "cam",
      title: "On starts the webcam only for live sky, gaze, or live colour. Off stops it and does not open the camera.",
      checked: liveCam.camPolicy === "auto",
      onChange: (on) => this.setCamPolicy(on ? "auto" : "off"),
    });
    const mic = new Toggle({
      label: "mic",
      title: "On allows the pulse microphone, watchword, and hold-to-talk. Off stops every mic stream so the OS light goes out.",
      checked: liveMic.micPolicy === "auto",
      onChange: (on) => this.setMicPolicy(on ? "auto" : "off"),
    });
    const sound = new Toggle({
      label: "sound",
      title: "On allows plugin SFX, arcade sounds, and spoken replies. Off keeps the speakers silent. Starts off.",
      checked: liveSound.soundOn,
      onChange: (on) => this.setSoundOn(on),
    });
    const row = document.createElement("div");
    row.className = "sec-controls";
    row.append(cam.el, mic.el, sound.el);
    sec.append(row);
    this.deviceUi = { cam, mic, sound };
    this.pane("privacy").appendChild(sec);
  }

  private buildViewPane(): void {
    const host = document.createElement("div");
    this.viewHost = host;
    this.pane("view").appendChild(host);
    this.bindView(null);
  }

  setCamPolicy(p: CamPolicy): void {
    if (p === "auto") clearMediaDismiss("cam");
    else dropMediaAsk("cam");
    liveCam.setPolicy(p);
    if (this.deviceUi) this.deviceUi.cam.checked = p === "auto";
    document.body.classList.toggle("cam-off", p === "off");
    this.onCamPolicy?.(p);
  }

  setMicPolicy(p: MicPolicy): void {
    if (p === "auto") clearMediaDismiss("mic");
    else dropMediaAsk("mic");
    liveMic.setPolicy(p);
    if (this.deviceUi) this.deviceUi.mic.checked = p === "auto";
    document.body.classList.toggle("mic-off", p === "off");
    this.onMicPolicy?.(p);
    this.cfg.onChange();
  }

  setSoundOn(on: boolean): void {
    liveSound.setOn(on);
    if (this.deviceUi) this.deviceUi.sound.checked = on;
    document.body.classList.toggle("sound-off", !on);
    this.onSoundPolicy?.(on);
    this.cfg.onChange();
  }

  /** Live pulse for the Audio tab meter. Call once the scene exists. */
  bindPulse(fn: () => { level: number; bass: number; listening?: boolean }): void {
    this.pulseNow = fn;
  }

  bindView(spec: PluginView | null, fields?: PluginField[], look?: PluginLook | null, extras?: HTMLElement[]): void {
    this.viewBind = { spec, fields, look, extras };
    const host = this.viewHost;
    if (!host) return;
    host.replaceChildren();
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
    if (spec) {
      const view = pluginLayer(
        "view",
        "View",
        spec.instanceId && spec.instanceId !== spec.id
          ? `Instance ${spec.instanceId} of ${spec.id}. Corner cog on a mosaic tile opens that tile's view.`
          : "This catalog row. Corner cog on a mosaic tile opens that tile's view.",
      );
      fillPluginFields(view, spec, pluginViewKnobs(spec, fields), (id, values) => {
        this.onPluginChange?.(id, values);
        this.cfg.onPersist?.();
      }, { skipEmpty: extra.length > 0, devices: this.nestDevices });
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
    } else if (!look && !extra.length && !this.viewMosaicSec) {
      const empty = document.createElement("div");
      empty.className = "sec";
      empty.innerHTML = `<div class="sec-title">View</div><div class="sec-hint">This view has no extra fields. The cog next to the view menu or on a mosaic tile opens this tab. Network and system visibility live under Graph. Host and subnet filters live under Privacy.</div>`;
      host.append(empty);
    }
    this.attachViewMosaic();
  }

  private attachViewMosaic(): void {
    const host = this.viewHost;
    const sec = this.viewMosaicSec;
    if (!host || !sec) return;
    host.append(sec);
    this.animUi?.syncTiles();
  }

  /** Refresh Nest camera chips when Device Access lists devices. */
  setNestDevices(devices: SdmDevice[]): void {
    const key = devices.map((d) => d.id).join("|");
    if (key === this.nestDeviceKey) return;
    this.nestDeviceKey = key;
    this.nestDevices = devices;
    if (this.viewBind?.spec?.id === "nest-cams") {
      this.bindView(this.viewBind.spec, this.viewBind.fields, this.viewBind.look, this.viewBind.extras);
    }
  }

  /** Setup card for a view that still needs a key or OAuth. */
  setAuthSetup(setup: AuthSetup | null, extra?: { pcmUrl?: string | null }): void {
    const host = this.viewHost;
    if (!host) return;
    host.querySelectorAll(":scope > .auth-setup, :scope > .sec.auth-setup-sec").forEach((n) => n.remove());
    if (!setup) return;
    const sec = pluginLayer("datasource", "Datasource", "Host primitive this view consumes — OAuth, keys, or a collector. Tokens stay on the host.");
    sec.classList.add("auth-setup-sec");
    sec.appendChild(renderAuthSetup(setup, extra));
    host.prepend(sec);
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

  /** Graph pane (Network / System / Look). */
  get host(): HTMLDivElement { return this.pane("graph"); }
  get privacyHost(): HTMLDivElement { return this.pane("privacy"); }

  /** Add a titled section of controls (used to move the header's show / privacy toggles into the popover). */
  addSection(title: string, controls: { el: HTMLElement }[], hint?: string): { el: HTMLElement; list: HTMLElement } {
    const sec = document.createElement("section");
    sec.className = "sec";
    const h = document.createElement("div");
    h.className = "sec-title";
    h.textContent = title;
    sec.appendChild(h);
    if (hint) {
      const p = document.createElement("div");
      p.className = "sec-hint";
      p.textContent = hint;
      sec.appendChild(p);
    }
    const list = document.createElement("div");
    list.className = "sec-controls";
    for (const c of controls) list.appendChild(c.el);
    sec.appendChild(list);
    const pane = title.toLowerCase() === "privacy" ? "privacy"
      : /^(show|network|system)$/.test(title.toLowerCase()) ? "graph"
      : "appearance";
    this.pane(pane).appendChild(sec);
    return { el: sec, list };
  }

  get animSettings(): DreamAnim { return this.anim; }
  get feedSettings(): FeedConfig { return this.feed; }
  get chatSettings(): ChatConfig { return this.chat; }
  get diceSettings(): DiceConfig { return this.dice; }

  private buildDice(): void {
    const host = this.pane("dice");
    const repeatSec = document.createElement("section");
    repeatSec.className = "sec";
    repeatSec.innerHTML = `<div class="sec-title">Repeat</div>
      <div class="sec-hint">Header dice: left switch is on/off repeat. The die on the right rolls now (switch stays). A roll on a plugin sky also changes view so the graph can morph. On also rolls once, then every N minutes. Roll now is always one shot.</div>`;
    const repeatList = document.createElement("div");
    repeatList.className = "sec-controls";
    const on = new Toggle({
      label: "dice",
      title: "repeat rolls on the minutes cadence (same as the header switch)",
      checked: this.dice.on,
      onChange: (v) => {
        const was = this.dice.on;
        this.dice.on = v;
        this.persistDice();
        if (v && !was) this.onDice?.();
      },
    });
    const period = new Slider({
      label: "every",
      title: "minutes between automatic rolls while dice is on",
      min: DICE_PERIOD.min, max: DICE_PERIOD.max, step: DICE_PERIOD.step, value: this.dice.periodMin,
      format: (v) => `${v} min`,
      onInput: (v) => { this.dice.periodMin = v; this.persistDice(); },
    });
    repeatList.append(on.el, period.el);
    repeatSec.appendChild(repeatList);

    const includeSec = document.createElement("section");
    includeSec.className = "sec";
    includeSec.innerHTML = `<div class="sec-title">Randomiser
      <span class="sec-links">
        <button type="button" class="link roll" title="one-shot roll (does not change the header switch)">roll now</button>
      </span></div>
      <div class="sec-hint">A roll randomizes the groups you leave on. Privacy filters, camera, microphone, sound, chrome placement, and prompts always stay. Views that still need a key or OAuth (Nest cams, Guardian until you replace api-key=test) stay out of the roll. Soft ceilings apply only to a roll — Settings sliders still go to the full range.</div>`;
    const includeList = document.createElement("div");
    includeList.className = "sec-controls dice-include";
    const include = {} as Record<DiceIncludeKey, Toggle>;
    for (const o of DICE_INCLUDE_META) {
      include[o.key] = new Toggle({
        label: o.label,
        title: o.hint,
        checked: this.dice.include[o.key],
        onChange: (on) => { this.dice.include[o.key] = on; this.persistDice(); },
      });
      includeList.appendChild(include[o.key].el);
    }
    includeSec.appendChild(includeList);
    includeSec.querySelector(".roll")!.addEventListener("click", () => this.onDice?.());

    const afterSec = document.createElement("section");
    afterSec.className = "sec";
    afterSec.innerHTML = `<div class="sec-title">After a roll</div>
      <div class="sec-hint">Dream cycling turns on the header AI look (view walk, randomized motion, Control). A roll does not start a chat or think turn.</div>`;
    const afterList = document.createElement("div");
    afterList.className = "sec-controls";
    const cycle = new Toggle({
      label: "dream + cycling",
      title: "after a roll, turn on dream camera, view cycling, randomized motion, and AI Control",
      checked: this.dice.cycle,
      onChange: (on) => { this.dice.cycle = on; this.persistDice(); },
    });
    afterList.append(cycle.el);
    afterSec.appendChild(afterList);

    const capSec = document.createElement("section");
    capSec.className = "sec";
    capSec.innerHTML = `<div class="sec-title">Soft ceilings</div>
      <div class="sec-hint">Dice-only caps so a roll does not tank the frame. Mosaic 2×4 and high node counts stay a manual choice unless you raise the ceiling.</div>`;
    const labels = new Slider({
      label: "labels", title: "max floating labels a roll may pick",
      min: B.labelCount.min, max: B.labelCount.max, step: B.labelCount.step, value: this.dice.labelsMax,
      onInput: (v) => { this.dice.labelsMax = v; this.persistDice(); },
    });
    const sparks = new Slider({
      label: "sparks", title: "max traffic particles a roll may pick",
      min: B.partCap.min, max: B.partCap.max, step: B.partCap.step, value: this.dice.sparksMax,
      onInput: (v) => { this.dice.sparksMax = v; this.persistDice(); },
    });
    const sparkPeak = new Slider({
      label: "spark peak", title: "max burst of sparks a roll may pick",
      min: B.partPeak.min, max: B.partPeak.max, step: B.partPeak.step, value: this.dice.sparkPeak,
      onInput: (v) => { this.dice.sparkPeak = v; this.persistDice(); },
    });
    const dens = new Slider({
      label: "feed density", title: "max feed lines a roll may pick",
      min: 12, max: 80, step: 1, value: this.dice.feedDensityMax,
      onInput: (v) => { this.dice.feedDensityMax = v; this.persistDice(); },
    });
    const nodeTop = new Slider({
      label: "node knobs", title: "max talkers / bluetooth node-count a roll may pick",
      min: 8, max: 80, step: 1, value: this.dice.nodeTop,
      onInput: (v) => { this.dice.nodeTop = v; this.persistDice(); },
    });
    const mosaicOpts: { value: DiceMosaicMax; label: string; hint: string }[] = [
      { value: "4", label: "2×2", hint: "rolls may pick one view or four tiles" },
      { value: "6", label: "2×3", hint: "rolls may pick up to six tiles (default)" },
      { value: "8", label: "2×4", hint: "rolls may pick eight WebGL graphs" },
    ];
    const mosaicRow = document.createElement("div");
    mosaicRow.className = "lookwrap";
    const mosaicCap = document.createElement("div");
    mosaicCap.className = "subcap";
    mosaicCap.textContent = "mosaic max";
    const mosaic = chips(mosaicOpts, this.dice.mosaicMax, (v) => { this.dice.mosaicMax = v; this.persistDice(); });
    mosaic.el.setAttribute("aria-label", "mosaic max");
    mosaicRow.append(mosaicCap, mosaic.el);
    const capList = document.createElement("div");
    capList.className = "sec-controls";
    capList.append(labels.el, sparks.el, sparkPeak.el, dens.el, nodeTop.el, mosaicRow);
    capSec.appendChild(capList);

    this.diceUi = {
      on, period, include, cycle, labels, sparks, sparkPeak, dens, nodeTop, setMosaicMax: mosaic.set,
    };
    host.append(repeatSec, includeSec, afterSec, capSec);
  }

  /**
   * Dream-camera sliders. Call after Show so the popover reads Network → System → Look on Graph.
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
      <div class="sec-hint">Dream (header D): orbit, nod, and zoom toward activity. Live traffic stays near the viewport centre about 70% of the time. See docs → Views and motion.</div>`;

    const follow = new Toggle({
      label: "zoom to activity",
      title: "dolly in toward the highest-activity nodes, then ease back; live traffic stays near the viewport centre about 70% of the orbit, wandering on the wide shot",
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
    const skyPick = new GroupedChips<BackdropKind>({
      label: "far-field sky",
      options: BACKDROP_OPTIONS,
      groups: SKY_GROUP_TABS,
      value: this.anim.backdrop,
      onChange: (v) => {
        if (v === "dynamic") invalidateSkyRecipe();
        this.anim.backdrop = v;
        this.persistAnim();
      },
    });
    const setSky = (v: BackdropKind) => skyPick.set(v);
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
    const skyAi = new Slider({
      label: "AI rebuild", title: "legacy minutes tick; Agent weather now owns how often AI Dynamic asks Gemma (probability bands)",
      min: B.skyAiMin.min, max: B.skyAiMin.max, step: B.skyAiMin.step, value: this.anim.skyAiMin,
      format: (v) => `${v}m`,
      onInput: (v) => { this.anim.skyAiMin = v; this.persistAnim(); },
    });
    type ModKey = "background" | "sky" | "floor" | "camera" | "nodes" | "skies" | "physics" | "particles";
    let setMod: (key: ModKey, on: boolean) => void = () => {};
    const skyPulse = new Toggle({
      label: "pulse",
      title: "modulate sky opacity and brightness from the audio / traffic pulse",
      checked: this.anim.skyAudio,
      onChange: (on) => { this.anim.skyAudio = on; setMod("sky", on); this.persistAnim(); },
    });
    const skyWrap = lookBlock("sky", skyPick.el, skyOp, skyBr, skySp, skyEz, skyAi);
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
    const gridFollow = new Slider({
      label: "follow",
      title: "0% keeps the floor world-fixed; 100% sits it under the graph so orbit, pan, and zoom move them together",
      min: 0, max: 100, step: 5, value: Math.round(this.anim.gridFollow * 100),
      format: (v) => `${v}%`,
      onInput: (v) => { this.anim.gridFollow = v / 100; this.persistAnim(); },
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
    const floorWrap = lookBlock("floor", shapeRow, gridColor, gridSize, gridFollow, gridOp, gridBr);
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
      { key: "skies", label: "skies", hint: "in dream, cycle authored skies independently of theme (cadence or beat). AI Dynamic is not in the pool", get: () => this.anim.skyCycle !== "off", set: (on) => { this.anim.skyCycle = on ? (this.anim.skyCycle === "off" ? "cadence" : this.anim.skyCycle) : "off"; } },
      { key: "floor", label: "floor", hint: "pulse the floor grid", get: () => this.anim.gridAudio, set: (on) => { this.anim.gridAudio = on; } },
      { key: "camera", label: "camera", hint: "FOV and dream orbit follow audio, how fast the graph/pulse is changing, and where you look (amounts under Camera)", get: () => this.anim.audioCamera, set: (on) => { this.anim.audioCamera = on; } },
      { key: "nodes", label: "nodes", hint: "bounce and glow graph nodes; fling harder on release", get: () => this.anim.audioNodes, set: (on) => { this.anim.audioNodes = on; } },
      { key: "physics", label: "physics", hint: "pulse magnets, gravity, swirl, and string sag", get: () => this.anim.audioPhysics, set: (on) => { this.anim.audioPhysics = on; } },
      { key: "particles", label: "sparks", hint: "pulse traffic spark count and speed", get: () => this.anim.audioParts, set: (on) => { this.anim.audioParts = on; } },
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
      if (key === "physics") this.animUi?.physPulse && (this.animUi.physPulse.checked = on);
      if (key === "particles") this.animUi?.partPulse && (this.animUi.partPulse.checked = on);
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
    const resetLayout = () => {
      this.anim.mosaicTree = null;
      this.anim.mosaicMaxId = "";
      this.anim.mosaicTiles = [];
    };
    const mosaic = chips(MOSAIC_SIZES, this.anim.mosaic, (v) => {
      this.anim.mosaic = v;
      resetLayout();
      this.persistAnim();
      this.animUi?.syncTiles();
    });
    const hero = chips(HERO_POS, this.anim.hero, (v) => {
      this.anim.hero = v;
      resetLayout();
      this.persistAnim();
      this.animUi?.syncTiles();
    });
    const tileHost = document.createElement("div");
    tileHost.className = "mosaic-slots";
    const syncTiles = () => this.fillMosaicSlots(tileHost);
    const resetBtn = document.createElement("button");
    resetBtn.type = "button";
    resetBtn.className = "link";
    resetBtn.textContent = "reset layout";
    resetBtn.title = "equal 2×N grid from the view count; forget dragged sizes and closed tiles";
    resetBtn.addEventListener("click", () => { resetLayout(); this.persistAnim(); syncTiles(); });
    const equalBtn = document.createElement("button");
    equalBtn.type = "button";
    equalBtn.className = "link";
    equalBtn.textContent = "equal tiles";
    equalBtn.title = "keep the arrangement; set every split back to 50/50";
    equalBtn.addEventListener("click", () => {
      if (this.anim.mosaicTree) this.anim.mosaicTree = equalize(this.anim.mosaicTree);
      this.persistAnim();
    });
    const sharedTheme = new Toggle({
      label: "one theme",
      title: "use the header colour theme on every tile. Off gives each view its own palette.",
      checked: !!this.anim.mosaicSharedTheme,
      onChange: (on) => { this.anim.mosaicSharedTheme = on; this.persistAnim(); },
    });
    const mosaicHint = document.createElement("div");
    mosaicHint.className = "sec-hint";
    mosaicHint.textContent = "A wall composes other views. Each tile is a view — menu on the tile, same pickers here, corner cog for that view's settings. Size the wall, then set every pane. Picking a view already on the wall swaps those two. Drag tiles to swap, gutters to resize, close to expand the neighbour.";
    const mosaicBtns = document.createElement("div");
    mosaicBtns.className = "sec-links";
    mosaicBtns.append(resetBtn, equalBtn);
    const mosaicBits = document.createElement("div");
    mosaicBits.className = "look-stack";
    mosaicBits.append(
      labeled("views", mosaic.el),
      labeled("hero", hero.el),
      labeled("tiles", tileHost),
      sharedTheme.el,
      mosaicHint,
      mosaicBtns,
    );
    const viewMosaic = document.createElement("div");
    viewMosaic.className = "sec mosaic-settings";
    const mosaicTitle = document.createElement("div");
    mosaicTitle.className = "sec-title";
    mosaicTitle.textContent = "Wall";
    viewMosaic.append(mosaicTitle, mosaicBits);
    this.viewMosaicSec = viewMosaic;
    this.attachViewMosaic();
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
    const autoTune = new Toggle({
      label: "auto-tune",
      title: "if the last 30 seconds average under 10 fps, ease idle labels, sparks, glow, sky, and pixel density down; after a view change (or on the same view) wait for a 1-minute recovered average, then ease back over about a minute (camera easing stretches that)",
      checked: this.anim.autoTune !== false,
      onChange: (on) => { this.anim.autoTune = on; this.persistAnim(); },
    });
    const nodes = new Slider({
      label: "nodes", title: "device sphere size",
      min: 40, max: 250, step: 5, value: Math.round(this.anim.nodeWeight * 100),
      format: (v) => `${v}%`,
      onInput: (v) => { this.anim.nodeWeight = v / 100; this.persistAnim(); },
    });
    const edges = new Slider({
      label: "edges", title: "link brightness (traffic spark size is under Physics)",
      min: 30, max: 250, step: 5, value: Math.round(this.anim.edgeWeight * 100),
      format: (v) => `${v}%`,
      onInput: (v) => { this.anim.edgeWeight = v / 100; this.persistAnim(); },
    });
    const glow = chips(EDGE_GLOWS, this.anim.edgeGlow, (v) => { this.anim.edgeGlow = v; this.persistAnim(); });
    const fabric = chips(FABRIC_OPTIONS, this.anim.graphFabric, (v) => { this.anim.graphFabric = v; this.persistAnim(); });
    const space = chips(GRAPH_SPACE_OPTIONS, this.anim.graphSpace, (v) => { this.anim.graphSpace = v; this.persistAnim(); });
    const layout = chips(GRAPH_LAYOUT_OPTIONS, this.anim.graphLayout, (v) => { this.anim.graphLayout = v; this.persistAnim(); });
    const links = chips(GRAPH_LINK_OPTIONS, this.anim.graphLinks, (v) => { this.anim.graphLinks = v; this.persistAnim(); });
    const focus = chips(FOCUS_MODES, this.anim.focus, (v) => { this.anim.focus = v; this.persistAnim(); });
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
    const layoutBits = document.createElement("div");
    layoutBits.className = "look-stack";
    layoutBits.append(labeled("theme cycle", themeCycle.el), labeled("sky cycle", skyCycle.el), labeled("focus", focus.el));
    const layoutWrap = lookBlock("layout", layoutBits);
    const audioBits = document.createElement("div");
    audioBits.className = "look-stack";
    audioBits.append(labeled("drive", drive.el), labeled("modulate", modRow));
    const audioWrap = lookBlock("reactivity", audioBits, sens);
    const meter = document.createElement("div");
    meter.className = "pulse-meter";
    meter.setAttribute("aria-label", "live pulse");
    meter.innerHTML = `
      <div class="pulse-src"></div>
      <div class="pulse-row"><span>level</span><span class="pulse-track"><i class="pulse-fill" data-k="level"></i></span></div>
      <div class="pulse-row"><span>bass</span><span class="pulse-track"><i class="pulse-fill" data-k="bass"></i></span></div>`;
    this.audioUi = {
      src: meter.querySelector(".pulse-src")!,
      level: meter.querySelector('[data-k="level"]')!,
      bass: meter.querySelector('[data-k="bass"]')!,
    };
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
      label: "inertia", title: "how heavily the camera resists all motion: orbit, nod, zoom, gaze, framing, field of view, and the coast after a drag. 0% tracks immediately; 100% glides over a few seconds. Pan and zoom stay where you release.",
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
    graphBits.append(
      labeled("glow", glow.el), labeled("style", fabric.el), labeled("space", space.el),
      labeled("layout", layout.el), labeled("links", links.el),
    );
    const graphWrap = lookBlock("", graphBits, labels, shown, nodes, edges, glowAmt, glowSpeed);
    const lookSec = document.createElement("section");
    lookSec.className = "sec";
    lookSec.innerHTML = `<div class="sec-title">Look</div>
      <div class="sec-hint">Label size, idle names, node and edge scale, edge glow, and graph style. Style is a 2D or 3D mesh any graph plugin can use (\`style.fabric\` / Look → style). Space forces a flat or volumetric layout. Layout pins tree / globe / bars, animated models, and insight placements: fractals (sierp / hilbert / koch / julia), radio FFT (spectrum / waterfall / carrier / array), and data structures (heap / trie / hash / matrix / queue) that map rate, hops, IPs, and spectrum bins. Links add directional arrows and hub bundling. Dice → graph style rolls style, space, layout, and links. Auto-tune eases labels, sparks, glow, sky, and pixel density if the last 30 seconds average under 10 fps.</div>`;
    lookSec.append(autoTune.el, graphWrap);

    const magFmt = (v: number) => (Math.abs(v) < 3 ? "off" : v > 0 ? `attract ${v}%` : `repel ${-v}%`);
    const magnetSelf = new Slider({
      label: MAGNET_FIELDS[0].label, title: MAGNET_FIELDS[0].hint,
      min: -100, max: 100, step: 5, value: Math.round(this.anim.magnetSelf * 100), format: magFmt,
      onInput: (v) => { this.anim.magnetSelf = v / 100; this.persistAnim(); },
    });
    const magnetGateway = new Slider({
      label: MAGNET_FIELDS[1].label, title: MAGNET_FIELDS[1].hint,
      min: -100, max: 100, step: 5, value: Math.round(this.anim.magnetGateway * 100), format: magFmt,
      onInput: (v) => { this.anim.magnetGateway = v / 100; this.persistAnim(); },
    });
    const magnetLan = new Slider({
      label: MAGNET_FIELDS[2].label, title: MAGNET_FIELDS[2].hint,
      min: -100, max: 100, step: 5, value: Math.round(this.anim.magnetLan * 100), format: magFmt,
      onInput: (v) => { this.anim.magnetLan = v / 100; this.persistAnim(); },
    });
    const magnetLocal = new Slider({
      label: MAGNET_FIELDS[3].label, title: MAGNET_FIELDS[3].hint,
      min: -100, max: 100, step: 5, value: Math.round(this.anim.magnetLocal * 100), format: magFmt,
      onInput: (v) => { this.anim.magnetLocal = v / 100; this.persistAnim(); },
    });
    const magnetInternet = new Slider({
      label: MAGNET_FIELDS[4].label, title: MAGNET_FIELDS[4].hint,
      min: -100, max: 100, step: 5, value: Math.round(this.anim.magnetInternet * 100), format: magFmt,
      onInput: (v) => { this.anim.magnetInternet = v / 100; this.persistAnim(); },
    });
    const magnetMulticast = new Slider({
      label: MAGNET_FIELDS[5].label, title: MAGNET_FIELDS[5].hint,
      min: -100, max: 100, step: 5, value: Math.round(this.anim.magnetMulticast * 100), format: magFmt,
      onInput: (v) => { this.anim.magnetMulticast = v / 100; this.persistAnim(); },
    });
    const magnetCross = new Slider({
      label: "cross", title: "attract or repel nodes of different types (LAN vs internet, and so on)",
      min: -100, max: 100, step: 5, value: Math.round(this.anim.magnetCross * 100), format: magFmt,
      onInput: (v) => { this.anim.magnetCross = v / 100; this.persistAnim(); },
    });
    const magnetRange = new Slider({
      label: "range", title: "how far magnets reach",
      min: 15, max: 200, step: 5, value: Math.round(this.anim.magnetRange * 100),
      format: (v) => `${v}%`,
      onInput: (v) => { this.anim.magnetRange = v / 100; this.persistAnim(); },
    });
    const gravity = new Slider({
      label: "gravity", title: "pull nodes toward the floor",
      min: 0, max: 200, step: 5, value: Math.round(this.anim.gravity * 100),
      format: (v) => `${v}%`,
      onInput: (v) => { this.anim.gravity = v / 100; this.persistAnim(); },
    });
    const swirl = new Slider({
      label: "swirl", title: "yaw torque so the cloud slowly orbits",
      min: 0, max: 200, step: 5, value: Math.round(this.anim.swirl * 100),
      format: (v) => `${v}%`,
      onInput: (v) => { this.anim.swirl = v / 100; this.persistAnim(); },
    });
    const chargeAmt = new Slider({
      label: "spread", title: "many-body charge: turn down to pack nodes, up to push them apart",
      min: 0, max: 200, step: 5, value: Math.round(this.anim.chargeAmt * 100),
      format: (v) => `${v}%`,
      onInput: (v) => { this.anim.chargeAmt = v / 100; this.persistAnim(); },
    });
    const spring = new Slider({
      label: "spring", title: "how hard edges pull their endpoints together",
      min: 0, max: 200, step: 5, value: Math.round(this.anim.spring * 100),
      format: (v) => `${v}%`,
      onInput: (v) => { this.anim.spring = v / 100; this.persistAnim(); },
    });
    const linkSpan = new Slider({
      label: "length", title: "rest length of edges (stringy slack when long, taut when short)",
      min: 40, max: 250, step: 5, value: Math.round(this.anim.linkSpan * 100),
      format: (v) => `${v}%`,
      onInput: (v) => { this.anim.linkSpan = v / 100; this.persistAnim(); },
    });
    const drag = new Slider({
      label: "drag", title: "how quickly node velocity dies (higher = heavier)",
      min: 12, max: 70, step: 1, value: Math.round(this.anim.drag * 100),
      format: (v) => `${v}%`,
      onInput: (v) => { this.anim.drag = v / 100; this.persistAnim(); },
    });
    const centerPull = new Slider({
      label: "center", title: "pull the whole graph toward the origin",
      min: 0, max: 200, step: 5, value: Math.round(this.anim.centerPull * 100),
      format: (v) => `${v}%`,
      onInput: (v) => { this.anim.centerPull = v / 100; this.persistAnim(); },
    });
    const stringAmt = new Slider({
      label: "string", title: "sag edges into catenary strings; sparks follow the curve",
      min: 0, max: 100, step: 5, value: Math.round(this.anim.stringAmt * 100),
      format: (v) => `${v}%`,
      onInput: (v) => { this.anim.stringAmt = v / 100; this.persistAnim(); },
    });
    const partAmt = new Slider({
      label: "density", title: "how many traffic sparks ride the edges",
      min: 0, max: 200, step: 5, value: Math.round(this.anim.partAmt * 100),
      format: (v) => `${v}%`,
      onInput: (v) => { this.anim.partAmt = v / 100; this.persistAnim(); },
    });
    const partBusy = new Slider({
      label: "rate", title: "how hard byte-rate feeds spark count (turn down to thin busy links)",
      min: 25, max: 300, step: 5, value: Math.round(this.anim.partBusy * 100),
      format: (v) => `${(v / 100).toFixed(2)}×`,
      onInput: (v) => { this.anim.partBusy = v / 100; this.persistAnim(); },
    });
    const partQuiet = new Slider({
      label: "quiet", title: "hide sparks on links slower than this (bytes/s)",
      min: B.partQuiet.min, max: B.partQuiet.max, step: B.partQuiet.step, value: this.anim.partQuiet,
      format: (v) => (v <= 0 ? "all" : `${v}`),
      onInput: (v) => { this.anim.partQuiet = v; this.persistAnim(); },
    });
    const partPeak = new Slider({
      label: "peak", title: "max sparks on one conversation",
      min: B.partPeak.min, max: B.partPeak.max, step: B.partPeak.step, value: this.anim.partPeak,
      format: (v) => `${v}`,
      onInput: (v) => { this.anim.partPeak = v; this.persistAnim(); },
    });
    const partCap = new Slider({
      label: "cap", title: "global spark budget",
      min: B.partCap.min, max: B.partCap.max, step: B.partCap.step, value: this.anim.partCap,
      format: (v) => `${v}`,
      onInput: (v) => { this.anim.partCap = v; this.persistAnim(); },
    });
    const partSpeed = new Slider({
      label: "speed", title: "how fast sparks travel along an edge",
      min: 25, max: 300, step: 5, value: Math.round(this.anim.partSpeed * 100),
      format: (v) => `${(v / 100).toFixed(2)}×`,
      onInput: (v) => { this.anim.partSpeed = v / 100; this.persistAnim(); },
    });
    const partSize = new Slider({
      label: "size", title: "spark size (also scaled by Look → edges)",
      min: 30, max: 250, step: 5, value: Math.round(this.anim.partSize * 100),
      format: (v) => `${v}%`,
      onInput: (v) => { this.anim.partSize = v / 100; this.persistAnim(); },
    });
    const physPulse = new Toggle({
      label: "pulse",
      title: "modulate magnets, gravity, swirl, and string sag from the audio / traffic pulse",
      checked: this.anim.audioPhysics,
      onChange: (on) => { this.anim.audioPhysics = on; setMod("physics", on); this.persistAnim(); },
    });
    const partPulse = new Toggle({
      label: "pulse",
      title: "modulate spark count and speed from the audio / traffic pulse",
      checked: this.anim.audioParts,
      onChange: (on) => { this.anim.audioParts = on; setMod("particles", on); this.persistAnim(); },
    });
    const magnetWrap = lookBlock("magnets", null, magnetSelf, magnetGateway, magnetLan, magnetLocal, magnetInternet, magnetMulticast, magnetCross, magnetRange);
    magnetWrap.querySelector(".look-head")!.appendChild(physPulse.el);
    const fieldWrap = lookBlock("field", null, gravity, swirl, chargeAmt, spring, linkSpan, drag, centerPull, stringAmt);
    const sparkWrap = lookBlock("sparks", null, partAmt, partBusy, partQuiet, partPeak, partCap, partSpeed, partSize);
    sparkWrap.querySelector(".look-head")!.appendChild(partPulse.el);
    const physSec = document.createElement("section");
    physSec.className = "sec";
    physSec.innerHTML = `<div class="sec-title">Physics</div>
      <div class="sec-hint">Cut traffic sparks with density / rate / quiet / peak / cap. Magnets attract or repel each node type. String sags the edges; gravity, swirl, spread, and springs move the cloud. Pulse lives under Audio → modulate too.</div>`;
    physSec.append(sparkWrap, magnetWrap, fieldWrap);
    this.pane("physics").appendChild(physSec);

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
    sec.append(row, bgWrap, skyWrap, floorWrap, layoutWrap, grid);
    this.animUi = {
      follow, cycle, randomize, setSky, setShape,
      setDrive: drive.set, setThemeCycle: themeCycle.set, setSkyCycle: skyCycle.set, setMosaic: mosaic.set, setHero: hero.set, syncTiles, sharedTheme, setFocus: focus.set, setGlow: glow.set, setFabric: fabric.set, setSpace: space.set, setLayout: layout.set, setLinks: links.set, setMod,
      skyPulse, floorPulse, bgPulse,
      skyOp, skyBr, skySp, skyEz, skyAi, gridOp, gridBr, gridSize, gridFollow, gridColor, bgColor, bgOp,
      yaw, pitch, pitchCycle, zoom, zoomCycle, cadence, camAudio, camChange, camGaze, camInertia, camEase, camTheme, sens,
      labels, shown, nodes, edges, glowAmt, glowSpeed, autoTune,
      partAmt, partBusy, partQuiet, partPeak, partCap, partSpeed, partSize,
      magnetSelf, magnetGateway, magnetLan, magnetLocal, magnetInternet, magnetMulticast,
      magnetCross, magnetRange, gravity, swirl, chargeAmt, spring, linkSpan, drag, centerPull, stringAmt,
      physPulse, partPulse,
    };
    sec.querySelector(".reset")!.addEventListener("click", () => {
      this.anim = { ...DEFAULT_DREAM };
      this.syncAnimUi();
      this.persistAnim();
    });
    sec.querySelector(".shuffle")!.addEventListener("click", () => this.shuffleAnim());
    this.pane("motion").appendChild(sec);
    this.pane("graph").appendChild(lookSec);
    this.pane("camera").appendChild(camWrap);
    const audioSec = document.createElement("section");
    audioSec.className = "sec";
    audioSec.innerHTML = `<div class="sec-title">Audio</div>
      <div class="sec-hint">What drives the pulse and what it moves. The microphone on/off switch lives under Privacy (same as the header mic). Traffic or the selected node still drive the pulse when the mic is off. Feed bars have their own modulate switch on the Feed tab.</div>`;
    audioSec.append(audioWrap, meter);
    this.pane("audio").appendChild(audioSec);
  }

  private buildSources(): void {
    const sec = document.createElement("section");
    sec.className = "sec";
    const auth = document.createElement("div");
    auth.className = "source-auth";
    sec.innerHTML = `<div class="sec-title">Data sources</div>
      <div class="sec-hint">RSS, public HTTPS JSON/text, local files under $HOME / ~/.zoto-viz, the user journal, and the kernel ring (/dev/kmsg). HTTP JSON can map list / title / caption / image fields. Views (carousel, rain, term) are instances of one plugin pointed at a source — do not fork a tree per feed. Sources that need a key show the signup link here and stay out of dice until they work.</div>`;
    const include = new Toggle({
      label: "headlines on feed",
      title: "show RSS / HTTP / file / journal / kmsg titles on the live feed ticker",
      checked: this.feed.includeSources !== false,
      onChange: (v) => { this.feed.includeSources = v; this.persistFeed(); },
    });
    const list = document.createElement("div");
    list.className = "source-list";
    const form = document.createElement("form");
    form.className = "source-form";
    form.innerHTML = `
      <div class="sec-title">Add source</div>
      <label>type <select name="type">
        <option value="rss">RSS</option>
        <option value="http">HTTPS</option>
        <option value="file">local file</option>
        <option value="journal">user journal</option>
        <option value="kmsg">kernel ring</option>
      </select></label>
      <label>id <input name="id" maxlength="32" placeholder="hn" autocomplete="off"></label>
      <label>label <input name="label" maxlength="80" placeholder="Hacker News"></label>
      <label class="src-url">url <input name="url" placeholder="https://…"></label>
      <label class="src-path" hidden>path <input name="path" placeholder="~/.zoto-viz/sources/notes.txt"></label>
      <label class="src-unit" hidden>unit <input name="unit" placeholder="optional, e.g. zoto-viz-monitor.service"></label>
      <label>interval <input name="interval" type="number" min="15" max="86400" value="300"> s</label>
      <label class="src-fields" hidden>fields <textarea name="fields" rows="3" placeholder='{"list":"data","title":"title","image":"hdurl","filter":"has-image"}'></textarea></label>
      <button type="submit" class="btn primary">add</button>
      <div class="src-err" hidden></div>`;
    const typeSel = form.querySelector<HTMLSelectElement>("[name=type]")!;
    const urlLab = form.querySelector<HTMLLabelElement>(".src-url")!;
    const pathLab = form.querySelector<HTMLLabelElement>(".src-path")!;
    const unitLab = form.querySelector<HTMLLabelElement>(".src-unit")!;
    const fieldsLab = form.querySelector<HTMLLabelElement>(".src-fields")!;
    const err = form.querySelector<HTMLElement>(".src-err")!;
    typeSel.addEventListener("change", () => {
      const kind = typeSel.value;
      urlLab.hidden = kind !== "rss" && kind !== "http";
      pathLab.hidden = kind !== "file";
      unitLab.hidden = kind !== "journal";
      fieldsLab.hidden = kind !== "http";
    });
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const kind = String(fd.get("type") || "rss") as SourceKind;
      const body: Record<string, unknown> = {
        id: String(fd.get("id") || "").trim(),
        type: kind,
        label: String(fd.get("label") || "").trim(),
        interval: Number(fd.get("interval") || 300),
        enabled: true,
        feed: true,
      };
      if (kind === "file") body.path = String(fd.get("path") || "").trim();
      else if (kind === "journal") {
        const unit = String(fd.get("unit") || "").trim();
        if (unit) body.unit = unit;
      } else if (kind !== "kmsg") body.url = String(fd.get("url") || "").trim();
      if (kind === "http") {
        const raw = String(fd.get("fields") || "").trim();
        if (raw) {
          try {
            const mapped = JSON.parse(raw) as unknown;
            if (mapped && typeof mapped === "object" && !Array.isArray(mapped)) body.fields = mapped;
          } catch {
            err.textContent = "fields must be JSON";
            err.hidden = false;
            return;
          }
        }
      }
      err.hidden = true;
      void apiFetch("/api/sources", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }).then(async (r) => {
        const data = await r.json().catch(() => ({})) as { error?: string };
        if (!r.ok) {
          err.textContent = data.error || r.statusText;
          err.hidden = false;
          return;
        }
        form.reset();
        typeSel.dispatchEvent(new Event("change"));
        void this.refreshSources();
      });
    });
    const inst = document.createElement("form");
    inst.className = "source-form";
    inst.innerHTML = `
      <div class="sec-title">View instances</div>
      <div class="sec-hint">Reuse carousel, rain, or term with another source. Shipped rows stay; these extras live in ~/.zoto-viz/plugin-instances.yml.</div>
      <label>plugin <select name="plugin">
        <option value="carousel">carousel (stills)</option>
        <option value="hn-rain">hn-rain</option>
        <option value="hn-term">hn-term</option>
      </select></label>
      <label>id <input name="id" maxlength="32" placeholder="apod" autocomplete="off"></label>
      <label>name <input name="name" maxlength="48" placeholder="APOD"></label>
      <label>source <input name="source" maxlength="32" placeholder="apod"></label>
      <button type="submit" class="btn primary">add view</button>
      <div class="src-err" hidden></div>`;
    const instList = document.createElement("div");
    instList.className = "source-list";
    const instErr = inst.querySelector<HTMLElement>(".src-err")!;
    inst.addEventListener("submit", (e) => {
      e.preventDefault();
      const fd = new FormData(inst);
      const body = {
        plugin: String(fd.get("plugin") || "").trim(),
        id: String(fd.get("id") || "").trim(),
        name: String(fd.get("name") || "").trim(),
        source: String(fd.get("source") || "").trim(),
      };
      instErr.hidden = true;
      void apiFetch("/api/plugin-instances", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }).then(async (r) => {
        const data = await r.json().catch(() => ({})) as { error?: string };
        if (!r.ok) {
          instErr.textContent = data.error || r.statusText;
          instErr.hidden = false;
          return;
        }
        inst.reset();
        void this.refreshInstances();
        this.onInstancesChange?.();
      });
    });
    sec.append(auth, include.el, list, form, inst, instList);
    this.pane("sources").appendChild(sec);
    this.sourcesUi = { list, include, instances: instList, auth };
    void this.refreshSources();
    void this.refreshInstances();
    void this.refreshAuthIntegrations();
  }

  private async refreshSources(): Promise<void> {
    const host = this.sourcesUi?.list;
    if (!host) return;
    try {
      const r = await apiFetch("/api/sources");
      if (!r.ok) throw new Error(r.statusText);
      const data = await r.json() as { sources?: SourceRow[]; live?: Record<string, SourceLive> };
      const rows = data.sources ?? [];
      const live = data.live ?? {};
      host.replaceChildren();
      if (!rows.length) {
        const empty = document.createElement("div");
        empty.className = "sec-hint";
        empty.textContent = "No sources yet. Add an RSS feed or a local file.";
        host.appendChild(empty);
        return;
      }
      for (const row of rows) {
        const el = document.createElement("div");
        el.className = "source-row";
        const status = live[row.id];
        const hint = !status || status.pending ? "waiting"
          : status.paused ? "paused"
          : status.ok === false ? (status.error || "error")
          : status.items ? `${status.items.length} items`
          : "ok";
        const on = new Toggle({
          label: row.label || row.id,
          title: `${row.type} · ${row.url || row.path || ""} · ${hint}`,
          checked: row.enabled !== false,
          onChange: (enabled) => {
            void apiFetch(`/api/sources/${encodeURIComponent(row.id)}`, {
              method: "PUT",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ ...row, enabled }),
            }).then(() => this.refreshSources());
          },
        });
        const meta = document.createElement("span");
        meta.className = "src-meta";
        meta.textContent = `${row.type} · ${hint}`;
        const drop = document.createElement("button");
        drop.type = "button";
        drop.className = "link";
        drop.textContent = "remove";
        drop.addEventListener("click", () => {
          void apiFetch(`/api/sources/${encodeURIComponent(row.id)}`, { method: "DELETE" })
            .then(() => this.refreshSources());
        });
        el.append(on.el, meta, drop);
        const block = document.createElement("div");
        block.className = "source-block";
        block.appendChild(el);
        const kind = sourceAuthKind(row.id, row.url || "");
        if (kind) {
          const ready = sourceAuthReady(kind, row.url || "", status);
          if (!ready || !AUTH_SETUPS[kind].blocksDice) {
            const card = renderAuthSetup(AUTH_SETUPS[kind]);
            if (ready && !AUTH_SETUPS[kind].blocksDice) card.classList.add("auth-setup-optional");
            block.appendChild(card);
          }
        }
        host.appendChild(block);
      }
    } catch {
      host.textContent = "Sources API unavailable (is the monitor running?)";
    }
  }

  private async refreshAuthIntegrations(): Promise<void> {
    const host = this.sourcesUi?.auth;
    if (!host) return;
    host.replaceChildren();
    try {
      const r = await apiFetch("/api/sdm");
      const sdm = r.ok ? await r.json() as { linked?: boolean; pcm_url?: string | null; error?: string } : {};
      if (sdm.linked) {
        const ok = document.createElement("div");
        ok.className = "sec-hint";
        ok.textContent = "Nest Device Access is linked. Nest cams can join dice.";
        host.appendChild(ok);
        return;
      }
      host.appendChild(renderAuthSetup(AUTH_SETUPS.sdm, { pcmUrl: sdm.pcm_url }));
    } catch {
      host.appendChild(renderAuthSetup(AUTH_SETUPS.sdm));
    }
  }

  private async refreshInstances(): Promise<void> {
    const host = this.sourcesUi?.instances;
    if (!host) return;
    try {
      const r = await apiFetch("/api/plugin-instances");
      if (!r.ok) throw new Error(r.statusText);
      const data = await r.json() as { instances?: { plugin: string; id: string; name?: string; source?: string }[] };
      const rows = data.instances ?? [];
      host.replaceChildren();
      if (!rows.length) {
        const empty = document.createElement("div");
        empty.className = "sec-hint";
        empty.textContent = "No extra views yet. Shipped NASA / APOD / HN rows already use this machinery.";
        host.appendChild(empty);
        return;
      }
      for (const row of rows) {
        const el = document.createElement("div");
        el.className = "source-row";
        const meta = document.createElement("span");
        meta.className = "src-meta";
        meta.textContent = `${row.plugin}:${row.id}${row.source ? ` · ${row.source}` : ""}${row.name ? ` · ${row.name}` : ""}`;
        const drop = document.createElement("button");
        drop.type = "button";
        drop.className = "link";
        drop.textContent = "remove";
        drop.addEventListener("click", () => {
          void apiFetch(`/api/plugin-instances/${encodeURIComponent(row.plugin)}/${encodeURIComponent(row.id)}`, {
            method: "DELETE",
          }).then(() => {
            void this.refreshInstances();
            this.onInstancesChange?.();
          });
        });
        el.append(meta, drop);
        host.appendChild(el);
      }
    } catch {
      host.textContent = "Instance API unavailable (is the monitor running?)";
    }
  }

  /** Live decoded-traffic overlay on the right of the graph. */
  addLiveFeed(onChange: (c: FeedConfig) => void): void {
    this.onFeedChange = onChange;
    const sec = document.createElement("section");
    sec.className = "sec";
    sec.innerHTML = `<div class="sec-title">Live feed</div>
      <div class="sec-hint">Decoded packets beside the graph. Headlines from Sources can ride the ticker. Chat is a separate panel (header chat / C). Header feed / F shows or hides this overlay.</div>`;
    const on = new Toggle({
      label: "show feed",
      title: "ticker and/or protocol bars on the right of the scene (header feed switch or F)",
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
    const size = new Slider({
      label: "text", title: "ticker type size",
      min: 10, max: 20, step: 0.5, value: this.feed.textSize,
      format: (v) => `${v}px`,
      onInput: (v) => { this.feed.textSize = v; this.persistFeed(); },
    });
    const row = document.createElement("div");
    row.className = "sec-controls";
    row.append(on.el, modulate.el);
    const bits = document.createElement("div");
    bits.className = "look-stack";
    bits.append(labeled("layout", layout.el), labeled("scope", scope.el));
    sec.append(row, lookBlock("overlay", bits, dens, size));
    this.feedUi = { on, modulate, setLayout: layout.set, setScope: scope.set, dens, size };
    this.pane("feed").appendChild(sec);
  }

  /** Agent conversation overlay, independent of the packet feed. */
  addChat(onChange: (c: ChatConfig) => void): void {
    this.onChatChange = onChange;
    const sec = document.createElement("section");
    sec.className = "sec";
    sec.innerHTML = `<div class="sec-title">Chat</div>
      <div class="sec-hint">Talk with the local agent. Discuss a view or source, then ask it to build. Header chat / C. Watchword opens this panel.</div>`;
    const on = new Toggle({
      label: "show chat",
      title: "agent conversation beside the scene (header chat switch or C)",
      checked: this.chat.on,
      onChange: (v) => this.setChatOn(v),
    });
    const size = new Slider({
      label: "text", title: "chat type size",
      min: 10, max: 20, step: 0.5, value: this.chat.textSize,
      format: (v) => `${v}px`,
      onInput: (v) => { this.chat.textSize = v; this.persistChat(); },
    });
    const row = document.createElement("div");
    row.className = "sec-controls";
    row.append(on.el);
    sec.append(row, size.el);
    this.chatUi = { on, size };
    this.pane("chat").appendChild(sec);
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
    this.anim = guardReadableAnim({
      ...DEFAULT_DREAM,
      ...a,
      mosaicTree: parseMosaicNode(a.mosaicTree) ?? a.mosaicTree ?? null,
      mosaicMaxId: typeof a.mosaicMaxId === "string" ? a.mosaicMaxId : "",
      mosaicTiles: parseMosaicTiles(a.mosaicTiles),
      mosaicSharedTheme: !!a.mosaicSharedTheme,
      mosaicUniqueSkies: a.mosaicUniqueSkies,
      mosaicSkies: a.mosaicSkies,
    });
    this.syncAnimUi();
    this.syncTheme();
    this.persistAnim();
  }

  /** Persist a live drag / close / max without resetting the tree. */
  applyMosaicLayout(patch: {
    tree: DreamAnim["mosaicTree"];
    maximized: string | null;
    tiles: string[];
    uniqueSkies?: boolean;
    skies?: DreamAnim["mosaicSkies"];
  }): void {
    this.anim.mosaicTree = parseMosaicNode(patch.tree);
    this.anim.mosaicMaxId = patch.maximized ?? "";
    this.anim.mosaicTiles = parseMosaicTiles(patch.tiles);
    if (patch.uniqueSkies !== undefined) {
      this.anim.mosaicUniqueSkies = patch.uniqueSkies;
      this.anim.mosaicSkies = patch.skies ?? {};
    }
    this.persistAnim();
    this.animUi?.syncTiles();
  }

  refreshMosaicSlots(): void { this.animUi?.syncTiles(); }

  private fillMosaicSlots(host: HTMLElement): void {
    host.replaceChildren();
    if (this.anim.mosaic === "off") {
      const empty = document.createElement("div");
      empty.className = "sec-hint";
      empty.textContent = "1× — turn on 2×2 / 2×3 / 2×4 to assign a view to every pane.";
      host.appendChild(empty);
      return;
    }
    const n = this.anim.mosaicTiles.length
      || (this.anim.mosaicTree ? leafIds(this.anim.mosaicTree).length : Number(this.anim.mosaic) || 0);
    const ids = this.anim.mosaicTiles.length
      ? this.anim.mosaicTiles
      : this.anim.mosaicTree
        ? leafIds(this.anim.mosaicTree)
        : Array.from({ length: n }, (_, i) => viewSelectOptions()[i]?.value ?? "");
    for (let i = 0; i < Math.max(ids.length, n); i++) {
      const cur = ids[i] ?? "";
      const row = document.createElement("div");
      row.className = "mosaic-pane-row";
      row.dataset.pane = cur;
      row.classList.toggle("focus", !!cur && cur === this.viewFocusId);
      const cap = document.createElement("div");
      cap.className = "subcap";
      cap.textContent = `pane ${i + 1}`;
      const sel = document.createElement("select");
      sel.className = "mosaic-slot";
      sel.setAttribute("aria-label", cap.textContent);
      fillViewSelect(sel, cur);
      sel.addEventListener("change", () => {
        const from = ids[i] ?? "";
        const to = sel.value;
        if (!from || from === to) return;
        if (this.onMosaicPanePick) {
          if (!this.onMosaicPanePick(from, to)) fillViewSelect(sel, from);
        } else {
          const next = nextPaneTiles(ids, from, to);
          this.anim.mosaicTiles = parseMosaicTiles(next);
          if (this.anim.mosaicTree) this.anim.mosaicTree = assignTiles(this.anim.mosaicTree, this.anim.mosaicTiles);
          this.persistAnim();
        }
        this.animUi?.syncTiles();
      });
      row.append(cap, sel);
      host.appendChild(row);
    }
  }

  /** Keep theme-follow swatches on the live theme (page chrome + default scene fill). */
  syncTheme(t = themeById(localStorage.getItem("zoto-viz.theme"))): void {
    this.animUi?.gridColor.setThemeHex(themeGridHex(t));
    this.animUi?.bgColor.setThemeHex(themeBgHex(t));
  }

  /** Header / Settings dice repeat switch. Does not roll. */
  setDiceOn(on: boolean): void {
    this.dice.on = on;
    if (this.diceUi) this.diceUi.on.checked = on;
    this.persistDice();
  }

  /** Session-only cypher-cic panel collapse (never persist collapsed visibility). */
  setCypherCicPanelCollapsed(collapsed: boolean): void {
    this.cypherCicPanelCollapsed = collapsed;
  }

  readPersistedFeedOn(): boolean {
    return localStorage.getItem(`${this.cfg.storePrefix}.feed.on`) !== "0";
  }

  readPersistedChatOn(): boolean {
    return localStorage.getItem(`${this.cfg.storePrefix}.chat.on`) !== "0";
  }

  private cypherCicPanelCollapsed = false;

  private feedOnForPersistence(): boolean {
    if (!this.cypherCicPanelCollapsed) return this.feed.on;
    const p = this.cfg.storePrefix;
    const raw = localStorage.getItem(`${p}.feed.on`);
    return raw !== "0";
  }

  private chatOnForPersistence(): boolean {
    if (!this.cypherCicPanelCollapsed) return this.chat.on;
    const p = this.cfg.storePrefix;
    const raw = localStorage.getItem(`${p}.chat.on`);
    return raw !== "0";
  }

  clearCypherCicPanelPersistOverrides(): void {
    this.setCypherCicPanelCollapsed(false);
  }

  /** Show or hide the right-hand activity list. Syncs the cog toggle and persists unless `persist` is false. */
  setFeedOn(on: boolean, opts?: { persist?: boolean }): void {
    this.feed.on = on;
    if (this.feedUi) this.feedUi.on.checked = on;
    if (opts?.persist === false) {
      this.onFeedChange(this.feed);
      return;
    }
    this.persistFeed({ onFromMemory: true });
  }

  /** Show or hide the agent chat panel. */
  setChatOn(on: boolean, opts?: { persist?: boolean }): void {
    this.chat.on = on;
    if (this.chatUi) this.chatUi.on.checked = on;
    if (opts?.persist === false) {
      this.onChatChange(this.chat);
      return;
    }
    this.persistChat({ onFromMemory: true });
  }

  /** Watchword: open the chat panel (pins to the latest line). */
  revealTranscript(): void {
    if (this.chat.on) return;
    this.setChatOn(true);
  }

  applyFeed(c: FeedConfig): void {
    this.feed = { ...DEFAULT_FEED, ...c, source: "traffic" };
    this.feed.textSize = Math.min(20, Math.max(10, this.feed.textSize || DEFAULT_FEED.textSize));
    const ui = this.feedUi;
    if (ui) {
      ui.on.checked = this.feed.on;
      ui.modulate.checked = this.feed.modulate;
      ui.setLayout(this.feed.layout);
      ui.setScope(this.feed.scope);
      ui.dens.value = this.feed.density;
      ui.size.value = this.feed.textSize;
    }
    if (this.sourcesUi) this.sourcesUi.include.checked = this.feed.includeSources !== false;
    this.persistFeed();
  }

  applyChat(c: ChatConfig): void {
    this.chat = { ...DEFAULT_CHAT, ...c };
    this.chat.textSize = Math.min(20, Math.max(10, this.chat.textSize || DEFAULT_CHAT.textSize));
    const ui = this.chatUi;
    if (ui) {
      ui.on.checked = this.chat.on;
      ui.size.value = this.chat.textSize;
    }
    this.persistChat();
  }

  applyDice(c: DiceConfig): void {
    this.dice = normalizeDice(c);
    const ui = this.diceUi;
    if (ui) {
      ui.on.checked = this.dice.on;
      ui.period.value = this.dice.periodMin;
      for (const o of DICE_INCLUDE_META) ui.include[o.key].checked = this.dice.include[o.key];
      ui.cycle.checked = this.dice.cycle;
      ui.labels.value = this.dice.labelsMax;
      ui.sparks.value = this.dice.sparksMax;
      ui.sparkPeak.value = this.dice.sparkPeak;
      ui.dens.value = this.dice.feedDensityMax;
      ui.nodeTop.value = this.dice.nodeTop;
      ui.setMosaicMax(this.dice.mosaicMax);
    }
    this.persistDice();
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
      backdrop: this.anim.backdrop === "none" || this.anim.backdrop === "dynamic" || this.anim.backdrop === "live" || this.anim.backdrop === "custom"
        ? this.anim.backdrop
        : pickSky(this.anim.backdrop),
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
    ui.skyAi.value = a.skyAiMin;
    ui.gridOp.value = Math.round(a.gridOpacity * 100);
    ui.gridBr.value = Math.round(a.gridBright * 100);
    ui.gridSize.value = a.gridSize;
    ui.gridFollow.value = Math.round(a.gridFollow * 100);
    ui.gridColor.value = a.gridColor;
    ui.bgColor.value = a.bgColor;
    ui.bgOp.value = Math.round(a.bgOpacity * 100);
    ui.setShape(a.gridShape);
    ui.setDrive(a.audioDrive);
    ui.setThemeCycle(a.themeCycle);
    ui.setSkyCycle(a.skyCycle);
    ui.setMosaic(a.mosaic);
    ui.setHero(a.hero);
    ui.syncTiles();
    ui.sharedTheme.checked = !!a.mosaicSharedTheme;
    ui.setFocus(a.focus);
    ui.setGlow(a.edgeGlow);
    ui.setFabric(a.graphFabric);
    ui.setSpace(a.graphSpace);
    ui.setLayout(a.graphLayout);
    ui.setLinks(a.graphLinks);
    ui.setMod("background", a.bgAudio);
    ui.setMod("sky", a.skyAudio);
    ui.setMod("skies", a.skyCycle !== "off");
    ui.setMod("floor", a.gridAudio);
    ui.setMod("camera", a.audioCamera);
    ui.setMod("nodes", a.audioNodes);
    ui.setMod("physics", a.audioPhysics);
    ui.setMod("particles", a.audioParts);
    ui.sens.value = Math.round(a.audioSens * 100);
    ui.camAudio.value = Math.round(a.camAudio * 100);
    ui.camChange.value = Math.round(a.camChange * 100);
    ui.camGaze.value = Math.round(a.camGaze * 100);
    ui.camInertia.value = Math.round(a.camInertia * 100);
    ui.camEase.value = Math.round(a.moveEase * 100);
    ui.camTheme.checked = a.camTheme;
    ui.labels.value = Math.round(a.labelWeight * 100);
    ui.shown.value = a.labelCount;
    ui.autoTune.checked = a.autoTune !== false;
    ui.nodes.value = Math.round(a.nodeWeight * 100);
    ui.edges.value = Math.round(a.edgeWeight * 100);
    ui.glowAmt.value = Math.round(a.edgeGlowAmt * 100);
    ui.glowSpeed.value = Math.round(a.edgeGlowSpeed * 100);
    ui.partAmt.value = Math.round(a.partAmt * 100);
    ui.partBusy.value = Math.round(a.partBusy * 100);
    ui.partQuiet.value = a.partQuiet;
    ui.partPeak.value = a.partPeak;
    ui.partCap.value = a.partCap;
    ui.partSpeed.value = Math.round(a.partSpeed * 100);
    ui.partSize.value = Math.round(a.partSize * 100);
    ui.magnetSelf.value = Math.round(a.magnetSelf * 100);
    ui.magnetGateway.value = Math.round(a.magnetGateway * 100);
    ui.magnetLan.value = Math.round(a.magnetLan * 100);
    ui.magnetLocal.value = Math.round(a.magnetLocal * 100);
    ui.magnetInternet.value = Math.round(a.magnetInternet * 100);
    ui.magnetMulticast.value = Math.round(a.magnetMulticast * 100);
    ui.magnetCross.value = Math.round(a.magnetCross * 100);
    ui.magnetRange.value = Math.round(a.magnetRange * 100);
    ui.gravity.value = Math.round(a.gravity * 100);
    ui.swirl.value = Math.round(a.swirl * 100);
    ui.chargeAmt.value = Math.round(a.chargeAmt * 100);
    ui.spring.value = Math.round(a.spring * 100);
    ui.linkSpan.value = Math.round(a.linkSpan * 100);
    ui.drag.value = Math.round(a.drag * 100);
    ui.centerPull.value = Math.round(a.centerPull * 100);
    ui.stringAmt.value = Math.round(a.stringAmt * 100);
    ui.physPulse.checked = a.audioPhysics;
    ui.partPulse.checked = a.audioParts;
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
    localStorage.setItem(`${p}.anim.skyAiMin`, String(a.skyAiMin));
    localStorage.setItem(`${p}.anim.skyAudio`, a.skyAudio ? "1" : "0");
    localStorage.setItem(`${p}.anim.bgAudio`, a.bgAudio ? "1" : "0");
    localStorage.setItem(`${p}.anim.bgColor`, a.bgColor);
    localStorage.setItem(`${p}.anim.bgOpacity`, String(a.bgOpacity));
    localStorage.setItem(`${p}.anim.gridOpacity`, String(a.gridOpacity));
    localStorage.setItem(`${p}.anim.gridBright`, String(a.gridBright));
    localStorage.setItem(`${p}.anim.gridAudio`, a.gridAudio ? "1" : "0");
    localStorage.setItem(`${p}.anim.gridColor`, a.gridColor);
    localStorage.setItem(`${p}.anim.gridSize`, String(a.gridSize));
    localStorage.setItem(`${p}.anim.gridFollow`, String(a.gridFollow));
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
    localStorage.setItem(`${p}.anim.autoTune`, a.autoTune !== false ? "1" : "0");
    localStorage.setItem(`${p}.anim.nodeWeight`, String(a.nodeWeight));
    localStorage.setItem(`${p}.anim.edgeWeight`, String(a.edgeWeight));
    localStorage.setItem(`${p}.anim.edgeGlow`, a.edgeGlow);
    localStorage.setItem(`${p}.anim.edgeGlowAmt`, String(a.edgeGlowAmt));
    localStorage.setItem(`${p}.anim.edgeGlowSpeed`, String(a.edgeGlowSpeed));
    localStorage.setItem(`${p}.anim.graphFabric`, a.graphFabric);
    localStorage.setItem(`${p}.anim.graphSpace`, a.graphSpace);
    localStorage.setItem(`${p}.anim.graphLayout`, a.graphLayout);
    localStorage.setItem(`${p}.anim.graphLinks`, a.graphLinks);
    localStorage.setItem(`${p}.anim.mosaic`, a.mosaic);
    localStorage.setItem(`${p}.anim.hero`, a.hero);
    if (a.mosaicTree) localStorage.setItem(`${p}.anim.mosaicTree`, JSON.stringify(a.mosaicTree));
    else localStorage.removeItem(`${p}.anim.mosaicTree`);
    localStorage.setItem(`${p}.anim.mosaicMaxId`, a.mosaicMaxId || "");
    if (a.mosaicTiles?.length) localStorage.setItem(`${p}.anim.mosaicTiles`, JSON.stringify(a.mosaicTiles));
    else localStorage.removeItem(`${p}.anim.mosaicTiles`);
    localStorage.setItem(`${p}.anim.mosaicSharedTheme`, a.mosaicSharedTheme ? "1" : "0");
    if (a.mosaicUniqueSkies === true) localStorage.setItem(`${p}.anim.mosaicUniqueSkies`, "1");
    else if (a.mosaicUniqueSkies === false) localStorage.setItem(`${p}.anim.mosaicUniqueSkies`, "0");
    else localStorage.removeItem(`${p}.anim.mosaicUniqueSkies`);
    if (a.mosaicSkies && Object.keys(a.mosaicSkies).length) {
      localStorage.setItem(`${p}.anim.mosaicSkies`, JSON.stringify(a.mosaicSkies));
    } else {
      localStorage.removeItem(`${p}.anim.mosaicSkies`);
    }
    localStorage.setItem(`${p}.anim.focus`, a.focus);
    localStorage.setItem(`${p}.anim.partAmt`, String(a.partAmt));
    localStorage.setItem(`${p}.anim.partBusy`, String(a.partBusy));
    localStorage.setItem(`${p}.anim.partQuiet`, String(a.partQuiet));
    localStorage.setItem(`${p}.anim.partPeak`, String(a.partPeak));
    localStorage.setItem(`${p}.anim.partCap`, String(a.partCap));
    localStorage.setItem(`${p}.anim.partSpeed`, String(a.partSpeed));
    localStorage.setItem(`${p}.anim.partSize`, String(a.partSize));
    localStorage.setItem(`${p}.anim.audioParts`, a.audioParts ? "1" : "0");
    localStorage.setItem(`${p}.anim.magnetSelf`, String(a.magnetSelf));
    localStorage.setItem(`${p}.anim.magnetGateway`, String(a.magnetGateway));
    localStorage.setItem(`${p}.anim.magnetLan`, String(a.magnetLan));
    localStorage.setItem(`${p}.anim.magnetLocal`, String(a.magnetLocal));
    localStorage.setItem(`${p}.anim.magnetInternet`, String(a.magnetInternet));
    localStorage.setItem(`${p}.anim.magnetMulticast`, String(a.magnetMulticast));
    localStorage.setItem(`${p}.anim.magnetCross`, String(a.magnetCross));
    localStorage.setItem(`${p}.anim.magnetRange`, String(a.magnetRange));
    localStorage.setItem(`${p}.anim.gravity`, String(a.gravity));
    localStorage.setItem(`${p}.anim.swirl`, String(a.swirl));
    localStorage.setItem(`${p}.anim.chargeAmt`, String(a.chargeAmt));
    localStorage.setItem(`${p}.anim.spring`, String(a.spring));
    localStorage.setItem(`${p}.anim.linkSpan`, String(a.linkSpan));
    localStorage.setItem(`${p}.anim.drag`, String(a.drag));
    localStorage.setItem(`${p}.anim.centerPull`, String(a.centerPull));
    localStorage.setItem(`${p}.anim.stringAmt`, String(a.stringAmt));
    localStorage.setItem(`${p}.anim.audioPhysics`, a.audioPhysics ? "1" : "0");
    this.onAnimChange(a);
    this.cfg.onPersist?.();
  }

  private persistFeed(opts?: { onFromMemory?: boolean }): void {
    const p = this.cfg.storePrefix;
    const c = this.feed;
    const on = opts?.onFromMemory ? c.on : this.feedOnForPersistence();
    localStorage.setItem(`${p}.feed.on`, on ? "1" : "0");
    localStorage.setItem(`${p}.feed.layout`, c.layout);
    localStorage.setItem(`${p}.feed.scope`, c.scope);
    localStorage.setItem(`${p}.feed.source`, c.source);
    localStorage.setItem(`${p}.feed.density`, String(c.density));
    localStorage.setItem(`${p}.feed.textSize`, String(c.textSize));
    localStorage.setItem(`${p}.feed.modulate`, c.modulate ? "1" : "0");
    localStorage.setItem(`${p}.feed.includeSources`, c.includeSources === false ? "0" : "1");
    this.onFeedChange(c);
    this.cfg.onPersist?.();
  }

  private persistChat(opts?: { onFromMemory?: boolean }): void {
    const p = this.cfg.storePrefix;
    const c = this.chat;
    const on = opts?.onFromMemory ? c.on : this.chatOnForPersistence();
    localStorage.setItem(`${p}.chat.on`, on ? "1" : "0");
    localStorage.setItem(`${p}.chat.textSize`, String(c.textSize));
    this.onChatChange(c);
    this.cfg.onPersist?.();
  }

  private persistDice(): void {
    localStorage.setItem(`${this.cfg.storePrefix}.dice`, JSON.stringify(this.dice));
    this.onDiceChange?.(this.dice);
    this.cfg.onPersist?.();
  }

  private storeKey(key: string): string { return `${this.cfg.storePrefix}.filter.${key}`; }

  get isOpen(): boolean { return !this.pop.hidden; }

  private pinFloat(): void {
    if (this.pop.parentElement === document.body && this.pop.classList.contains("flyout")) return;
    this.pop.classList.add("flyout");
    this.pop.classList.remove("right");
    document.body.appendChild(this.pop);
    this.pop.style.position = "fixed";
  }

  open(pane?: string): void {
    if (pane) this.showPane(pane);
    this.pop.hidden = false;
    this.el.classList.add("open");
    this.btn.setAttribute("aria-expanded", "true");
    this.syncViewCog();
    const saved = readFloatRect("settings");
    if (this.pop.classList.contains("floated") || saved) {
      this.pinFloat();
      if (saved) applyFloatRect(this.pop, saved, { w: 360, h: 280 });
    } else {
      const chrome = document.body.dataset.chrome;
      if (chrome === "left" || chrome === "right") {
        this.pop.classList.remove("right");
        pinFlyout(this.pop, this.btn, chrome);
      } else {
        unpinFlyout(this.pop, this.el);
        const r = this.pop.getBoundingClientRect();
        this.pop.classList.toggle("right", r.right > innerWidth - 8);
      }
    }
    this.syncTheme();
    document.addEventListener("pointerdown", this.onDocDown, true);
    this.tickMeter();
  }

  close(): void {
    this.viewFocusId = "";
    this.pop.hidden = true;
    this.el.classList.remove("open");
    this.btn.setAttribute("aria-expanded", "false");
    this.syncViewCog();
    if (!this.pop.classList.contains("floated")) unpinFlyout(this.pop, this.el);
    document.removeEventListener("pointerdown", this.onDocDown, true);
    cancelAnimationFrame(this.meterRaf);
    this.meterRaf = 0;
    this.onClose?.();
  }

  private tickMeter = (): void => {
    if (!this.isOpen) return;
    this.meterRaf = requestAnimationFrame(this.tickMeter);
    const ui = this.audioUi;
    if (!ui || this.activePane !== "audio") return;
    const p = this.pulseNow();
    ui.level.style.width = `${Math.round(Math.max(0, Math.min(1, p.level)) * 100)}%`;
    ui.bass.style.width = `${Math.round(Math.max(0, Math.min(1, p.bass)) * 100)}%`;
    ui.src.textContent = p.listening ? "mic live" : liveMic.micPolicy === "off" ? "mic off · traffic fallback" : "traffic fallback";
  };

  private onDocDown = (e: PointerEvent) => {
    const t = e.target as HTMLElement;
    if (this.viewCog?.contains(t) || t.closest(".mosaic-pane-cog")) return;
    if (t.closest(".float-handle, .float-resize")) return;
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

    if (!this.activeCount) {
      // No filters: the common case. Skip the name normalisation entirely — it is the single hottest
      // string path when the graph re-checks every device's visibility.
      this.test = () => true;
      return;
    }
    const needNames = allowNames.length > 0 || blockNames.length > 0;
    const needAddrs = allowNets.length > 0 || blockNets.length > 0;
    this.test = (d: Device): boolean => {
      const names = needNames ? deviceNames(d) : EMPTY;
      const addrs = needAddrs ? deviceAddrs(d) : EMPTY;
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
  if (caption) {
    const head = document.createElement("div");
    head.className = "look-head";
    const cap = document.createElement("span");
    cap.className = "cap";
    cap.textContent = caption;
    head.appendChild(cap);
    wrap.appendChild(head);
  }
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
  return guardReadableAnim({
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
    skyAiMin: n("skyAiMin", d.skyAiMin, B.skyAiMin.min, B.skyAiMin.max),
    skyAudio: localStorage.getItem(`${prefix}.anim.skyAudio`) !== "0",
    bgAudio: localStorage.getItem(`${prefix}.anim.bgAudio`) === "1",
    gridOpacity: n("gridOpacity", d.gridOpacity, B.opacity.min, B.opacity.max),
    gridBright: n("gridBright", d.gridBright, B.bright.min, B.bright.max),
    gridAudio: localStorage.getItem(`${prefix}.anim.gridAudio`) !== "0",
    gridColor: parseGridColor(localStorage.getItem(`${prefix}.anim.gridColor`)),
    bgColor: parseGridColor(localStorage.getItem(`${prefix}.anim.bgColor`)),
    bgOpacity: n("bgOpacity", d.bgOpacity, B.opacity.min, B.opacity.max),
    gridSize: n("gridSize", d.gridSize, B.gridSize.min, B.gridSize.max),
    gridFollow: n("gridFollow", d.gridFollow, B.gridFollow.min, B.gridFollow.max),
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
    autoTune: localStorage.getItem(`${prefix}.anim.autoTune`) !== "0",
    nodeWeight: n("nodeWeight", d.nodeWeight, B.nodeWeight.min, B.nodeWeight.max),
    edgeWeight: n("edgeWeight", d.edgeWeight, B.edgeWeight.min, B.edgeWeight.max),
    edgeGlow: parseGlow(localStorage.getItem(`${prefix}.anim.edgeGlow`)),
    edgeGlowAmt: n("edgeGlowAmt", d.edgeGlowAmt, B.edgeGlowAmt.min, B.edgeGlowAmt.max),
    edgeGlowSpeed: n("edgeGlowSpeed", d.edgeGlowSpeed, B.edgeGlowSpeed.min, B.edgeGlowSpeed.max),
    graphFabric: parseFabricKind(localStorage.getItem(`${prefix}.anim.graphFabric`)),
    graphSpace: parseGraphSpaceKind(localStorage.getItem(`${prefix}.anim.graphSpace`)),
    graphLayout: parseGraphLayoutKind(localStorage.getItem(`${prefix}.anim.graphLayout`)),
    graphLinks: parseGraphLinksKind(localStorage.getItem(`${prefix}.anim.graphLinks`)),
    mosaic: parseMosaic(localStorage.getItem(`${prefix}.anim.mosaic`)),
    hero: parseHero(localStorage.getItem(`${prefix}.anim.hero`)),
    mosaicTree: parseStoredTree(localStorage.getItem(`${prefix}.anim.mosaicTree`)),
    mosaicMaxId: localStorage.getItem(`${prefix}.anim.mosaicMaxId`)?.trim() ?? "",
    mosaicTiles: parseStoredTiles(localStorage.getItem(`${prefix}.anim.mosaicTiles`)),
    mosaicSharedTheme: localStorage.getItem(`${prefix}.anim.mosaicSharedTheme`) === "1",
    mosaicUniqueSkies: parseStoredUniqueSkies(localStorage.getItem(`${prefix}.anim.mosaicUniqueSkies`)),
    mosaicSkies: parseStoredSkies(localStorage.getItem(`${prefix}.anim.mosaicSkies`)),
    focus: parseFocus(localStorage.getItem(`${prefix}.anim.focus`)),
    partAmt: n("partAmt", d.partAmt, B.partAmt.min, B.partAmt.max),
    partBusy: n("partBusy", d.partBusy, B.partBusy.min, B.partBusy.max),
    partQuiet: n("partQuiet", d.partQuiet, B.partQuiet.min, B.partQuiet.max),
    partPeak: n("partPeak", d.partPeak, B.partPeak.min, B.partPeak.max),
    partCap: n("partCap", d.partCap, B.partCap.min, B.partCap.max),
    partSpeed: n("partSpeed", d.partSpeed, B.partSpeed.min, B.partSpeed.max),
    partSize: n("partSize", d.partSize, B.partSize.min, B.partSize.max),
    audioParts: localStorage.getItem(`${prefix}.anim.audioParts`) === "1",
    magnetSelf: n("magnetSelf", d.magnetSelf, B.magnet.min, B.magnet.max),
    magnetGateway: n("magnetGateway", d.magnetGateway, B.magnet.min, B.magnet.max),
    magnetLan: n("magnetLan", d.magnetLan, B.magnet.min, B.magnet.max),
    magnetLocal: n("magnetLocal", d.magnetLocal, B.magnet.min, B.magnet.max),
    magnetInternet: n("magnetInternet", d.magnetInternet, B.magnet.min, B.magnet.max),
    magnetMulticast: n("magnetMulticast", d.magnetMulticast, B.magnet.min, B.magnet.max),
    magnetCross: n("magnetCross", d.magnetCross, B.magnet.min, B.magnet.max),
    magnetRange: n("magnetRange", d.magnetRange, B.magnetRange.min, B.magnetRange.max),
    gravity: n("gravity", d.gravity, B.gravity.min, B.gravity.max),
    swirl: n("swirl", d.swirl, B.swirl.min, B.swirl.max),
    chargeAmt: n("chargeAmt", d.chargeAmt, B.chargeAmt.min, B.chargeAmt.max),
    spring: n("spring", d.spring, B.spring.min, B.spring.max),
    linkSpan: n("linkSpan", d.linkSpan, B.linkSpan.min, B.linkSpan.max),
    drag: n("drag", d.drag, B.drag.min, B.drag.max),
    centerPull: n("centerPull", d.centerPull, B.centerPull.min, B.centerPull.max),
    stringAmt: n("stringAmt", d.stringAmt, B.stringAmt.min, B.stringAmt.max),
    audioPhysics: localStorage.getItem(`${prefix}.anim.audioPhysics`) === "1",
  });
}

function parseGlow(raw: string | null): EdgeGlow {
  return EDGE_GLOWS.some((o) => o.value === raw) ? (raw as EdgeGlow) : DEFAULT_DREAM.edgeGlow;
}

function parseFabricKind(raw: string | null): FabricKind {
  return FABRIC_OPTIONS.some((o) => o.value === raw) ? (raw as FabricKind) : DEFAULT_DREAM.graphFabric;
}

function parseGraphSpaceKind(raw: string | null): GraphSpace {
  return GRAPH_SPACE_OPTIONS.some((o) => o.value === raw) ? (raw as GraphSpace) : DEFAULT_DREAM.graphSpace;
}

function parseGraphLayoutKind(raw: string | null): GraphLayout {
  return GRAPH_LAYOUT_OPTIONS.some((o) => o.value === raw) ? (raw as GraphLayout) : DEFAULT_DREAM.graphLayout;
}

function parseGraphLinksKind(raw: string | null): GraphLinks {
  return GRAPH_LINK_OPTIONS.some((o) => o.value === raw) ? (raw as GraphLinks) : DEFAULT_DREAM.graphLinks;
}

function parseMosaic(raw: string | null): MosaicSize {
  return MOSAIC_SIZES.some((o) => o.value === raw) ? (raw as MosaicSize) : DEFAULT_DREAM.mosaic;
}

function parseHero(raw: string | null): HeroPos {
  return HERO_POS.some((o) => o.value === raw) ? (raw as HeroPos) : DEFAULT_DREAM.hero;
}

function parseStoredTree(raw: string | null): DreamAnim["mosaicTree"] {
  if (!raw) return null;
  try { return parseMosaicNode(JSON.parse(raw)); } catch { return null; }
}

function parseStoredTiles(raw: string | null): string[] {
  if (!raw) return [];
  try { return parseMosaicTiles(JSON.parse(raw)); } catch { return []; }
}

function parseStoredUniqueSkies(raw: string | null): boolean | undefined {
  if (raw === "1") return true;
  if (raw === "0") return false;
  return undefined;
}

function parseStoredSkies(raw: string | null): DreamAnim["mosaicSkies"] {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
    const out: NonNullable<DreamAnim["mosaicSkies"]> = {};
    for (const [id, sky] of Object.entries(parsed)) {
      if (typeof sky === "string" && BACKDROP_OPTIONS.some((o) => o.value === sky)) {
        out[id] = sky as BackdropKind;
      }
    }
    return Object.keys(out).length ? out : undefined;
  } catch {
    return undefined;
  }
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
  const source = localStorage.getItem(`${prefix}.feed.source`);
  return {
    on: localStorage.getItem(`${prefix}.feed.on`) !== "0",
    layout: FEED_LAYOUTS.some((o) => o.value === layout) ? (layout as FeedLayout) : d.layout,
    scope: FEED_SCOPES.some((o) => o.value === scope) ? (scope as FeedScope) : d.scope,
    source: FEED_SOURCES.some((o) => o.value === source) ? (source as FeedSource) : d.source,
    density: n("density", d.density, 12, 80),
    textSize: n("textSize", d.textSize, 10, 20),
    modulate: localStorage.getItem(`${prefix}.feed.modulate`) !== "0",
    includeSources: localStorage.getItem(`${prefix}.feed.includeSources`) !== "0",
  };
}

function loadChat(prefix: string): ChatConfig {
  const d = DEFAULT_CHAT;
  const size = clampNum(localStorage.getItem(`${prefix}.chat.textSize`), 10, 20, d.textSize);
  return {
    on: localStorage.getItem(`${prefix}.chat.on`) !== "0",
    textSize: size,
  };
}

function loadDice(prefix: string): DiceConfig {
  try {
    const raw = localStorage.getItem(`${prefix}.dice`);
    if (!raw) return normalizeDice(DEFAULT_DICE);
    return normalizeDice(JSON.parse(raw) as unknown);
  } catch {
    return normalizeDice(DEFAULT_DICE);
  }
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

const EMPTY: readonly string[] = [];

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
