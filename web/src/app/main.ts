import { NetScene, escapeHtml } from "../graph/scene";
import { Panel } from "../ui/panel";
import { MODES, GRAPH_MODES, allModes, defaultOpts, modeById, type ViewMode } from "../core/modes";
import { ago, fmtBytes, type Device, type LinkStatus, type StateMsg } from "../core/types";
import { collapseByName } from "../core/collapse";
import { rCidr, rIp, rMac, redaction } from "../core/redact";
import { THEMES, alignThemeToColor, applyThemeChrome, themeById, themeSwatch, type Theme } from "../core/themes";
import { Select, Toggle } from "../ui/ui";
import { Settings } from "../ui/settings";
import { LiveFeed, feedViewShift } from "../ui/feed";
import { liveCam } from "../camera/livecam";
import { ProfileStore, quiet, SHIPPED_ID, type ProfileSettings } from "../core/profiles";
import { PongView } from "../arcade/pong";
import { InvadersView } from "../arcade/invaders";
import { CommandView } from "../arcade/command";
import { FroggerView } from "../arcade/frogger";
import { CpuPongView } from "../arcade/cpupong";
import { Mosaic } from "../graph/mosaic";
import {
  applyPluginConfigs,
  collectPluginConfigs,
  fetchPlugins,
  grantPluginConsent,
  installPlugins,
  loadPluginConfig,
  lookForMode,
  mergeLook,
  pluginNeedsReview,
  pluginViewId,
  viewSelectOptions,
  type PluginView,
} from "../plugins/plugin";
import { askPluginReview } from "../plugins/plugin-ui";
import { bootSession, apiFetch } from "../core/http";
import { bindFps } from "../core/fps";
import { AgentPanel } from "../ui/agent";
import { PluginSandbox, consentHash, tsPluginsAllowed } from "../plugins/host";
import { captureHud, pickAgentSettings } from "../ui/capture";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

type ChromePos = "top" | "left" | "right";
const CHROME_OPTS: { value: ChromePos; label: string; hint: string }[] = [
  { value: "top", label: "top", hint: "header across the top" },
  { value: "left", label: "left", hint: "wide bar on the left; inspect panel stays on the right" },
  { value: "right", label: "right", hint: "wide bar on the right; inspect panel moves to the left" },
];
const parseChrome = (raw: string | null | undefined): ChromePos =>
  raw === "left" || raw === "right" ? raw : "top";
let chrome: ChromePos = parseChrome(localStorage.getItem("zoto-viz.chrome"));
let userChrome: ChromePos = chrome;
document.body.dataset.chrome = chrome;

// one-time migration: netviz.* and z-netviz.* → zoto-viz.*
for (const k of Object.keys(localStorage)) {
  let nk: string | null = null;
  if (k.startsWith("z-netviz.")) nk = `zoto-viz.${k.slice("z-netviz.".length)}`;
  else if (k.startsWith("netviz.")) nk = `zoto-viz.${k.slice("netviz.".length)}`;
  if (!nk || nk === k) continue;
  if (localStorage.getItem(nk) === null) localStorage.setItem(nk, localStorage.getItem(k)!);
  localStorage.removeItem(k);
}

// ---------------------------------------------------------------- theme (before the scene so its first frame is right)

let theme: Theme = themeById(localStorage.getItem("zoto-viz.theme"));
applyThemeChrome(theme);

const scene = new NetScene($("scene"));
bindFps($("fps"));
const panel = new Panel($("panel"), scene);
let selectedIp: string | null = null; // the graph selection becomes the arcade views' source / device when one is entered
scene.onSelect = (d) => { selectedIp = d?.ip ?? null; panel.show(d); };
scene.setTheme(theme);

/** the standalone (arcade) views, by mode id; each owns a canvas in its own full-screen container */
interface Standalone { controls: HTMLElement[]; start(preferIp?: string | null): void; stop(): void; update(m: StateMsg): void; setTheme(t: Theme): void }
const arcade: Record<string, { view: Standalone; el: HTMLElement }> = {
  netpong: { view: new PongView($("pong"), scene), el: $("pong") },
  invaders: { view: new InvadersView($("invaders"), scene), el: $("invaders") },
  command: { view: new CommandView($("command"), scene), el: $("command") },
  frogger: { view: new FroggerView($("frogger"), scene), el: $("frogger") },
  cpupong: { view: new CpuPongView($("cpupong"), scene), el: $("cpupong") },
};
for (const a of Object.values(arcade)) a.view.setTheme(theme);
let activeArcade: string | null = null;
(window as unknown as { zotoviz: NetScene; znetviz: NetScene }).zotoviz = scene;
(window as unknown as { znetviz: NetScene }).znetviz = scene; // one-release alias
let mosaic: Mosaic | null = null;

const themeSel = new Select({
  id: "theme",
  caption: "theme",
  title: "colour theme (key T cycles)",
  options: THEMES.map((t) => ({ value: t.id, label: t.label, hint: t.hint, swatch: themeSwatch(t) })),
  value: theme.id,
  onChange: (id) => applyTheme(id),
});

const chromeSel = new Select({
  id: "chrome",
  caption: "chrome",
  title: "where the menus sit: top header, or a wide left/right bar (the other side holds the inspect panel)",
  options: CHROME_OPTS,
  value: chrome,
  onChange: (id) => applyChrome(parseChrome(id)),
});

let profiles: ProfileStore | null = null;
const touch = () => profiles?.touch();

const profileSel = new Select({
  id: "profile",
  caption: "profile",
  title: "settings profile (~/.zoto-viz/profiles.yml); netviz is the shipped default",
  options: [{ value: SHIPPED_ID, label: SHIPPED_ID, hint: "shipped" }],
  value: SHIPPED_ID,
  onChange: (id) => { void profiles?.select(id); },
});

const dreamToggle = new Toggle({
  id: "dream",
  label: "dream",
  title: "slowly orbit, nod, and zoom toward busy nodes (key D); speeds are in the settings cog",
  checked: localStorage.getItem("zoto-viz.dream") === "1",
  onChange: (on) => setDream(on),
});
const dreamCog = new Toggle({
  id: "dream-cog",
  label: "dream camera",
  title: "slowly orbit, nod, and zoom toward busy nodes (key D)",
  checked: localStorage.getItem("zoto-viz.dream") === "1",
  onChange: (on) => setDream(on),
});
$("dreamBox").appendChild(dreamToggle.el);
function setDream(on: boolean): void {
  dreamToggle.checked = on;
  dreamCog.checked = on;
  localStorage.setItem("zoto-viz.dream", on ? "1" : "0");
  if (mosaic) mosaic.eachGraph((s) => s.setDream(on));
  else scene.setDream(on);
  touch();
}
setDream(dreamToggle.checked);

let themeFollow: (t: Theme) => void = () => {};

/** Paint chrome + scene from a palette without writing the selected theme id. */
function paintLiveTheme(t: Theme, fade = false): void {
  applyThemeChrome(t);
  scene.setTheme(t, fade);
  if (mosaic?.on) mosaic.setTheme(t);
  else for (const a of Object.values(arcade)) a.view.setTheme(t);
  themeFollow(t);
  renderLegend(scene.currentMode, currentOpts);
}

/** Selected theme, optionally hue-shifted toward the webcam's current main colour. */
function paintedTheme(base: Theme): Theme {
  const hex = scene.liveCamColor;
  if (scene.dreamAnim.camTheme && hex != null) return alignThemeToColor(base, hex);
  return base;
}

function applyTheme(id: string, fade = false, persist = true): void {
  theme = themeById(id);
  paintLiveTheme(paintedTheme(theme), fade);
  if (!persist) return;
  themeSel.value = theme.id;
  localStorage.setItem("zoto-viz.theme", theme.id);
  touch();
}

/** set once the settings cog, chrome buttons and show / privacy sections exist; applyMode before that skips the look pass */
let uiReady = false;

/** Pin theme / sky / floor / modulation from the active view's plugin YAML without writing the profile. */
function applyViewLook(): void {
  if (!uiReady) return;
  if (mosaic?.on) {
    mosaic.applyLooks(settings.animSettings);
    mosaic.setTheme(scene.currentTheme);
    applyChrome(userChrome, false);
    return;
  }
  const look = lookForMode(modeSel.value);
  scene.setAnim(mergeLook(settings.animSettings, look));
  const want = look?.theme ?? localStorage.getItem("zoto-viz.theme") ?? theme.id;
  if (theme.id !== want) applyTheme(want, !!look?.theme, false);
  applyChrome(look?.chrome ?? userChrome, false);
}

function cycleRandomTheme(): void {
  const pool = THEMES.filter((t) => t.id !== theme.id);
  if (!pool.length) return;
  applyTheme(pool[Math.floor(Math.random() * pool.length)]!.id, true);
}

// ---------------------------------------------------------------- view modes

let currentOpts: Record<string, string> = {};
let pluginSpecs: PluginView[] = [];
let settings!: Settings;
const sandbox = new PluginSandbox();
sandbox.handlers = {
  setStyle: (s) => scene.setPluginStyle(s),
  setNodeColor: (id, hex) => scene.setPluginNodeColor(id, hex),
};
const agent = new AgentPanel();
const feedCtl: { feed: LiveFeed | null } = { feed: null };
let feedShiftInited = false;
function syncFeedShift(): void {
  if (!feedCtl.feed) return;
  scene.setViewShift(feedViewShift($("livefeed").offsetWidth, chrome, $("scene").clientWidth), !feedShiftInited);
  feedShiftInited = true;
}
const modeSel = new Select({
  id: "mode",
  caption: "view",
  title: `view mode (keys 1–9, 0 for the ${MODES.length}th)`,
  options: viewSelectOptions(),
  onChange: (id) => applyMode(id),
});
$("modeBox").append(modeSel.el);

function onPluginFields(): void {
  const m = modeById(modeSel.value);
  const opts = optsFor(m);
  currentOpts = opts;
  if (mosaic?.on && !(m.pluginId && m.standalone)) mosaic.graphScene(m.id)?.setMode(m, opts);
  else scene.setMode(m, opts);
  renderLegend(m, opts);
  void syncWifiWatch();
}

/**
 * The Air SSIDs rotation is a monitor-side setting (it writes the channel plan the root hopper follows), so the
 * Wi-Fi plugin's watch fields are pushed to /api/rf/watch whenever they may have changed: the active Wi-Fi view's
 * values win, otherwise the first Wi-Fi plugin's. Unchanged values are not re-sent.
 */
let wifiWatchSent = "";
async function syncWifiWatch(): Promise<void> {
  const active = modeById(modeSel.value);
  const spec = active.graphBase === "wifi" && active.pluginId
    ? pluginSpecs.find((p) => p.id === active.pluginId)
    : pluginSpecs.find((p) => p.base === "wifi");
  if (!spec) return;
  const o = optsFor(spec.id === active.pluginId ? active : modeById(pluginViewId(spec.id)));
  if (o.watch === undefined) return;
  const body = JSON.stringify({
    ssids: o.watch,
    other: o.other === "1",
    dwell: Number(o.dwell) || 60,
    rotate: o.rotate !== "0",
  });
  if (body === wifiWatchSent) return;
  wifiWatchSent = body;
  try {
    await apiFetch("/api/rf/watch", { method: "PUT", headers: { "content-type": "application/json" }, body });
  } catch {
    wifiWatchSent = ""; // try again on the next change
  }
}

function optsFor(m: ViewMode): Record<string, string> {
  const o = defaultOpts(m);
  if (m.pluginId) {
    const spec = pluginSpecs.find((p) => p.id === m.pluginId);
    if (spec) Object.assign(o, loadPluginConfig(spec, m.config));
  }
  for (const opt of m.options ?? []) {
    const saved = localStorage.getItem(`zoto-viz.mode.${m.id}.${opt.key}`);
    if (saved !== null && opt.values.some(([v]) => v === saved)) o[opt.key] = saved;
  }
  return o;
}

let tsWatch = 0;
let tsWatchId = "";
let tsWatchHash = "";

async function ensureReviewed(spec: PluginView | null): Promise<boolean> {
  if (!spec || !pluginNeedsReview(spec)) return true;
  if (spec.consent) return true;
  const kind = await askPluginReview(spec);
  if (!kind) return false;
  try {
    await grantPluginConsent(spec.id, kind);
    spec.consent = kind;
    if (spec.hash) consentHash(spec.id, spec.hash);
    return true;
  } catch (e) {
    console.warn("zoto-viz plugin consent:", e);
    return false;
  }
}

async function loadTsPlugin(spec: PluginView | null): Promise<void> {
  if (!spec || spec.runtime !== "typescript" || !spec.hash) {
    sandbox.unload();
    scene.clearPluginStyle();
    tsWatchId = "";
    return;
  }
  if (!tsPluginsAllowed()) {
    sandbox.unload();
    scene.clearPluginStyle();
    tsWatchId = "";
    return;
  }
  if (pluginNeedsReview(spec) && !spec.consent) {
    sandbox.unload();
    scene.clearPluginStyle();
    tsWatchId = "";
    return;
  }
  try {
    const r = await apiFetch(`/api/plugins/${spec.id}/module.js`);
    if (!r.ok) throw new Error(`module ${r.status}`);
    const js = await r.text();
    await sandbox.load(spec.id, js, spec.capabilities ?? [], loadPluginConfig(spec, spec.config));
    tsWatchId = spec.id;
    tsWatchHash = spec.hash;
    if (!tsWatch) tsWatch = window.setInterval(() => void refreshTsPlugin(), 2500);
  } catch (e) {
    console.warn("zoto-viz plugin runtime:", e);
    sandbox.unload();
    scene.clearPluginStyle();
  }
}

async function refreshTsPlugin(): Promise<void> {
  if (!tsWatchId || !tsPluginsAllowed()) return;
  try {
    const data = await fetchPlugins();
    const next = data.plugins.find((p) => p.id === tsWatchId);
    if (next?.hash && next.hash !== tsWatchHash) {
      const spec = pluginSpecs.find((p) => p.id === tsWatchId);
      if (spec) {
        spec.hash = next.hash;
        spec.capabilities = next.capabilities;
        spec.consent = next.consent ?? null;
        if (!(await ensureReviewed(spec))) return;
        await loadTsPlugin(spec);
      }
    }
  } catch { /* monitor down */ }
}

function applyMode(id: string): void {
  const m = modeById(id);
  const opts = optsFor(m);
  currentOpts = opts;
  modeSel.value = m.id;
  localStorage.setItem("zoto-viz.mode", m.id);
  touch();

  const spec = m.pluginId ? pluginSpecs.find((p) => p.id === m.pluginId) ?? null : null;
  settings?.bindView(spec, spec ? m.config : undefined, lookForMode(m.id) ?? spec?.look);
  modeSel.el.classList.toggle("has-plugin-fields", !!(spec?.config?.length));
  void (async () => {
    if (!(await ensureReviewed(spec))) return;
    void loadTsPlugin(spec);
  })();
  feedCtl.feed?.setGraphBase(m.graphBase);
  if (m.graphBase === "wifi") void syncWifiWatch();

  if (mosaic?.on && !(m.pluginId && m.standalone)) {
    if (mosaic.heroPos !== "off" && mosaic.heroMode !== m.id) {
      mosaic.setSize(mosaic.current, m.id, mosaic.heroPos);
    }
    mosaic.focus(m.id);
    const target = mosaic.graphScene(id);
    if (target) target.setMode(m, opts);
    document.body.classList.remove("arcade");
    scene.setActive(true);
    scene.setStageOnly(false);
    const box = $("modeOpts");
    box.innerHTML = "";
    const arcadeSlot = arcade[m.arcadeId ?? id];
    if (arcadeSlot) box.append(...arcadeSlot.view.controls);
    for (const opt of m.options ?? []) {
      const sel = new Select({
        caption: opt.label,
        options: opt.values.map(([value, label]) => ({ value, label })),
        value: opts[opt.key],
        onChange: (v) => {
          opts[opt.key] = v;
          localStorage.setItem(`zoto-viz.mode.${m.id}.${opt.key}`, v);
          touch();
          mosaic?.graphScene(id)?.setMode(m, opts);
          renderLegend(m, opts);
        },
      });
      box.appendChild(sel.el);
    }
    renderLegend(m, opts);
    $("hint").textContent = m.hint;
    applyViewLook();
    return;
  }

  scene.setMode(m, opts);

  // a standalone mode (an arcade view) keeps the 3D sky and floor; the graph hides
  const next = m.standalone ? (m.arcadeId ?? m.id) : null;
  document.body.classList.toggle("arcade", next !== null);
  scene.setActive(true);
  scene.setStageOnly(next !== null);
  if (activeArcade && activeArcade !== next) { arcade[activeArcade].view.stop(); arcade[activeArcade].el.hidden = true; }
  if (next && activeArcade !== next) { arcade[next].el.hidden = false; arcade[next].view.start(selectedIp); }
  activeArcade = next;
  syncFeedShift();

  // per-mode option selects
  const box = $("modeOpts");
  box.innerHTML = "";
  if (next) box.append(...arcade[next].view.controls);
  for (const opt of m.options ?? []) {
    const sel = new Select({
      caption: opt.label,
      options: opt.values.map(([value, label]) => ({ value, label })),
      value: opts[opt.key],
      onChange: (v) => {
        opts[opt.key] = v;
        localStorage.setItem(`zoto-viz.mode.${m.id}.${opt.key}`, v);
        touch();
        scene.setMode(m, opts);
        renderLegend(m, opts);
      },
    });
    box.appendChild(sel.el);
  }
  renderLegend(m, opts);
  $("hint").textContent = m.hint;
  applyViewLook();
}

function renderLegend(m: ViewMode, opts: Record<string, string>): void {
  const el = $("legend");
  el.innerHTML = "";
  for (const item of m.legend(opts)) {
    const s = document.createElement("span");
    const i = document.createElement("i");
    i.style.background = item.color;
    if (item.line) i.classList.add("line");
    if (item.color === "transparent") i.classList.add("none");
    s.append(i, item.label);
    el.appendChild(s);
  }
}

applyMode(localStorage.getItem("zoto-viz.mode") ?? MODES[0].id);

// ---------------------------------------------------------------- visibility filters

const FILTERS = [
  ["showLan", "lan", "LAN devices", "devices on the local network (the ring around the gateway); this host, the gateway and local containers / VMs stay"],
  ["showInternet", "internet", "internet", "internet endpoints (outer sphere)"],
  ["showMulticast", "multicast", "multicast", "multicast / broadcast groups"],
  ["showOffline", "offline", "offline", "devices not seen recently"],
  ["showLabels", "labels", "labels", "node labels"],
] as const;
const filterToggles = FILTERS.map(([id, key, label, title]) => {
  const saved = localStorage.getItem(`zoto-viz.${key}`);
  const t = new Toggle({
    id, label, title,
    checked: saved !== null ? saved === "1" : true,
    onChange: (on) => {
      scene.setFilters({ [key]: on });
      mosaic?.eachGraph((s) => { if (s !== scene) s.setFilters({ [key]: on }); });
      localStorage.setItem(`zoto-viz.${key}`, on ? "1" : "0");
      touch();
    },
  });
  scene.setFilters({ [key]: t.checked });
  return t;
});
// "merge names" is a data transform rather than a visibility filter: the last raw snapshot is re-fed through it
let lastRaw: StateMsg | null = null;
const mergeToggle = new Toggle({
  id: "mergeNames", label: "merge names", title: "collapse internet hosts that share a hostname (CDN aliases). LAN devices with the same factory name stay separate — Wi-Fi+Ethernet of one box is already folded by MAC",
  checked: localStorage.getItem("zoto-viz.merge") === "1",
  onChange: (on) => { localStorage.setItem("zoto-viz.merge", on ? "1" : "0"); touch(); if (lastRaw) feed(lastRaw); },
});
function feed(m: StateMsg): void {
  lastRaw = m;
  let shown = m;
  if (mergeToggle.checked) {
    const c = collapseByName(m);
    scene.setAliasMap(c.map);
    mosaic?.eachGraph((s) => { if (s !== scene) s.setAliasMap(c.map); });
    scene.update(c.msg);
    mosaic?.update(c.msg);
    for (const a of Object.values(arcade)) a.view.update(c.msg);
    shown = c.msg;
  } else {
    scene.setAliasMap(new Map());
    scene.update(m);
    mosaic?.eachGraph((s) => { if (s !== scene) s.setAliasMap(new Map()); });
    mosaic?.update(m);
    for (const a of Object.values(arcade)) a.view.update(m);
  }
  applyStats(shown);
  renderLegend(scene.currentMode, currentOpts);
  sandbox.tick(shown.devices.slice(0, 80).map((d) => ({
    id: d.ip,
    rate: d.packets,
    role: d.role,
  })));
}

// ---------------------------------------------------------------- redaction (screenshots / sharing)

let lastState: StateMsg | null = null;
const redactToggle = new Toggle({
  id: "redact", label: "redact", className: "warn",
  title: "partially mask addresses and device names for screenshots (key R)",
  onChange: (on) => setRedaction(on),
});
function setRedaction(on: boolean): void {
  redaction.enabled = on;
  redactToggle.checked = on;
  document.body.classList.toggle("redacted", on);
  localStorage.setItem("zoto-viz.redact", on ? "1" : "0");
  touch();
  if (lastState) applyStats(lastState);
  scene.refresh();
  mosaic?.eachGraph((s) => { if (s !== scene) s.refresh(); });
}
setRedaction(localStorage.getItem("zoto-viz.redact") === "1");

// ---------------------------------------------------------------- settings cog: allow/block filters + the moved show / privacy switches

settings = new Settings({
  storePrefix: "zoto-viz",
  onChange: () => {
    const fn = (d: Device) => settings.matches(d);
    if (mosaic) mosaic.eachGraph((s) => s.setNodeFilter(fn));
    else scene.setNodeFilter(fn);
  },
  onPersist: () => touch(),
});
settings.onPluginChange = () => onPluginFields();
const showSec = settings.addSection("Show", ...filterToggles, mergeToggle);
mosaic = new Mosaic({
  wall: $("wall"),
  sceneEl: $("scene"),
  main: scene,
  arcade,
  optsFor,
  onFocus: (id) => applyMode(id),
  sync: () => ({
    theme: scene.currentTheme,
    filters: scene.currentFilters,
    anim: settings.animSettings,
    dreaming: dreamToggle.checked,
    nodeFilter: (d) => settings.matches(d),
    lastMsg: lastRaw && mergeToggle.checked ? collapseByName(lastRaw).msg : lastRaw,
    aliasMap: lastRaw && mergeToggle.checked ? collapseByName(lastRaw).map : new Map(),
  }),
});
settings.addAnimation((a) => {
  if (mosaic!.on) mosaic!.applyLooks(a);
  else scene.setAnim(mergeLook(a, lookForMode(modeSel.value)));
  const key = `${a.mosaic}:${a.hero}:${a.mosaic !== "off" && a.hero !== "off" ? modeSel.value : ""}`;
  if (key !== mosaic!.layoutKey) {
    if (a.mosaic !== "off" && activeArcade) {
      arcade[activeArcade].view.stop();
      arcade[activeArcade].el.hidden = true;
      document.body.classList.remove("arcade");
      scene.setStageOnly(false);
      activeArcade = null;
    }
    mosaic!.setSize(a.mosaic, modeSel.value, a.hero);
    applyMode(modeSel.value);
    syncFeedShift();
  }
}, dreamCog);
themeFollow = (t) => settings.syncTheme(t);
settings.syncTheme(paintedTheme(theme));
scene.onCamTheme = (hex) => {
  if (hex == null) paintLiveTheme(theme);
  else paintLiveTheme(alignThemeToColor(theme, hex));
};
if (scene.dreamAnim.camTheme && scene.liveCamColor != null) scene.onCamTheme(scene.liveCamColor);
const liveFeed = new LiveFeed($("livefeed"), scene);
feedCtl.feed = liveFeed;
liveFeed.setGraphBase(modeById(modeSel.value).graphBase);
const feedToggle = new Toggle({
  id: "feed",
  label: "feed",
  title: "show the decoded activity list on the right (key F)",
  checked: settings.feedSettings.on,
  onChange: (on) => settings.setFeedOn(on),
});
$("feedBox").appendChild(feedToggle.el);
const camSel = new Select({
  id: "camera",
  caption: "camera",
  title: "webcam Auto / Off (Off never starts the camera)",
  options: [
    { value: "auto", label: "Auto", hint: "start only when live sky, gaze, or live colour need it" },
    { value: "off", label: "Off", hint: "never start the webcam" },
  ],
  value: liveCam.camPolicy,
  onChange: (v) => settings.setCamPolicy(v === "off" ? "off" : "auto"),
});
settings.onCamPolicy = (p) => { camSel.value = p; };
$("cameraBox").appendChild(camSel.el);
settings.addLiveFeed((c) => {
  liveFeed.setConfig(c);
  feedToggle.checked = c.on;
  if (c.source !== "traffic") liveFeed.seedTranscript(agent.transcript());
  syncFeedShift();
});
liveFeed.setConfig(settings.feedSettings);
syncFeedShift();
const feedShiftRo = new ResizeObserver(() => syncFeedShift());
feedShiftRo.observe($("livefeed"));
feedShiftRo.observe($("scene"));
liveFeed.onSourceChange = () => liveFeed.seedTranscript(agent.transcript());
agent.onChat = (role, text, stream) => liveFeed.pushChat(role, text, stream);
agent.onPhase = (phase) => liveFeed.setThinking(phase === "think");
agent.onTranscript = () => liveFeed.seedTranscript(agent.transcript());
agent.dictateInto = liveFeed.ask;
liveFeed.onSend = (text) => agent.offerSend(text);
liveFeed.onMicDown = () => agent.beginTalk();
liveFeed.onMicUp = () => agent.endTalk();
liveFeed.seedTranscript(agent.transcript());
const privSec = settings.addSection("Privacy", redactToggle);
$("settingsBox").appendChild(settings.el);
agent.mountSettings(settings.agentHost());
agent.onOpen = () => { settings.showPane("agent"); settings.open(); };
agent.captureView = () => captureHud({
  mode: modeSel.value,
  theme: theme.id,
  chrome: userChrome,
  dream: dreamToggle.checked,
  selected: scene.selectedIp,
  merge: mergeToggle.checked,
  redact: redaction.enabled,
  camera: liveCam.camPolicy,
  show: {
    lan: filterToggles[0]!.checked,
    internet: filterToggles[1]!.checked,
    multicast: filterToggles[2]!.checked,
    offline: filterToggles[3]!.checked,
    labels: filterToggles[4]!.checked,
  },
  feed: settings.feedSettings,
  feedLines: liveFeed.snapshot(3),
});
agent.onApplySettings = (patch) => {
  const p = pickAgentSettings(patch, allModes().map((m) => m.id));
  const next = collectSettings();
  if (p.theme) next.theme = p.theme;
  if (typeof p.dream === "boolean") next.dream = p.dream;
  if (p.chrome) next.chrome = p.chrome;
  if (p.mode) next.mode = p.mode;
  if (typeof p.redact === "boolean") next.redact = p.redact;
  if (typeof p.merge === "boolean") next.merge = p.merge;
  if (p.show) next.show = { ...next.show, ...p.show };
  if (p.feed) next.feed = { ...next.feed, ...p.feed };
  applySettings(next);
  if (p.camera) settings.setCamPolicy(p.camera);
};
$("aiBox").appendChild(agent.headerBtn);
scene.setNodeFilter((d) => settings.matches(d));
scene.setAnim(mergeLook(settings.animSettings, lookForMode(modeSel.value)));
if (settings.animSettings.mosaic !== "off") {
  mosaic.setSize(settings.animSettings.mosaic, modeSel.value, settings.animSettings.hero);
  applyMode(modeSel.value);
}
scene.onDreamPulse = () => {
  quiet(() => {
    const a = settings.animSettings;
    if (a.cycle && !mosaic?.on) {
      const i = Math.max(0, GRAPH_MODES.findIndex((m) => m.id === modeSel.value));
      applyMode(GRAPH_MODES[(i + 1) % GRAPH_MODES.length].id);
    }
    if (a.randomize) settings.shuffleAnim();
    if (a.themeCycle === "cadence") cycleRandomTheme();
    if (a.skyCycle === "cadence") settings.cycleSky();
  });
};
scene.onThemePulse = () => quiet(() => {
  const a = settings.animSettings;
  if (a.themeCycle === "audio") cycleRandomTheme();
  if (a.skyCycle === "audio") settings.cycleSky();
});

const layoutBtns = new Map<ChromePos, HTMLButtonElement>();
const layoutRow = document.createElement("div");
layoutRow.className = "skypick";
layoutRow.setAttribute("role", "radiogroup");
layoutRow.setAttribute("aria-label", "chrome position");
for (const o of CHROME_OPTS) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "sky";
  b.textContent = o.label;
  b.title = o.hint;
  b.setAttribute("aria-pressed", o.value === chrome ? "true" : "false");
  b.addEventListener("click", () => applyChrome(o.value));
  layoutBtns.set(o.value, b);
  layoutRow.appendChild(b);
}

function placeQuick(pos: ChromePos): void {
  const quick = $("quick");
  if (pos === "top") {
    settings.host.append(showSec.el);
    settings.privacyHost.append(privSec.el);
    quick.hidden = true;
  } else {
    quick.append(showSec.el, privSec.el);
    quick.hidden = false;
  }
}

function syncChromeMetrics(): void {
  const barEl = $("bar");
  const side = chrome !== "top";
  document.documentElement.style.setProperty("--bar-h", side ? "0px" : `${barEl.offsetHeight}px`);
  document.documentElement.style.setProperty("--bar-w", side ? `${barEl.offsetWidth}px` : "0px");
}

function applyChrome(pos: ChromePos, fromUser = true): void {
  chrome = pos;
  document.body.dataset.chrome = pos;
  chromeSel.value = pos;
  for (const [k, btn] of layoutBtns) btn.setAttribute("aria-pressed", k === pos ? "true" : "false");
  placeQuick(pos);
  syncChromeMetrics();
  syncFeedShift();
  if (fromUser) {
    userChrome = pos;
    localStorage.setItem("zoto-viz.chrome", pos);
    touch();
  }
}
applyChrome(chrome, false);

const profileBar = document.createElement("div");
profileBar.id = "profileBar";
document.body.appendChild(profileBar);
const profileTools = document.createElement("div");
profileTools.className = "prow";
const profileHost = document.createElement("div");
profileHost.className = "sec-controls";
profileHost.append(profileSel.el, profileTools);
const chromeHost = document.createElement("div");
chromeHost.className = "sec-controls";
chromeHost.append(chromeSel.el, layoutRow);
profiles = new ProfileStore(
  { collect: collectSettings, apply: applySettings },
  profileSel,
  profileBar,
  profileTools,
);
settings.prependSection(
  "Theme",
  "Colour theme. A plugin look can pin this; the chip in This view explains why.",
  themeSel.el,
);
settings.prependSection(
  "Chrome",
  "Header position. Left/right is a wide bar; inspect sits on the other side.",
  chromeHost,
);
settings.prependSection(
  "Profile",
  "Saved in ~/.zoto-viz/profiles.yml. netviz is the shipped default.",
  profileHost,
);
uiReady = true;
applyViewLook();
void (async () => {
  const session = await bootSession();
  agent.setControlFromServer(session.aiControl);
  pluginSpecs = await installPlugins();
  modeSel.setOptions(viewSelectOptions());
  await profiles.boot();
  applyMode(modeSel.value);
  applyViewLook();
  void syncWifiWatch();
  agent.armWake();
})();

function collectSettings(): ProfileSettings {
  const modeOptions: Record<string, Record<string, string>> = {};
  for (const m of allModes()) modeOptions[m.id] = optsFor(m);
  const arcade: Record<string, string> = {};
  for (const k of Object.keys(localStorage)) {
    if (/^zoto-viz\.(pong|invaders|command|frogger|cpupong)\./.test(k)) arcade[k] = localStorage.getItem(k) ?? "";
  }
  return {
    theme: localStorage.getItem("zoto-viz.theme") ?? theme.id,
    dream: dreamToggle.checked,
    mode: modeSel.value,
    modeOptions,
    show: {
      lan: filterToggles[0]!.checked,
      internet: filterToggles[1]!.checked,
      multicast: filterToggles[2]!.checked,
      offline: filterToggles[3]!.checked,
      labels: filterToggles[4]!.checked,
    },
    merge: mergeToggle.checked,
    redact: redactToggle.checked,
    filters: settings.filterText(),
    anim: { ...settings.animSettings },
    feed: { ...settings.feedSettings },
    arcade,
    chrome: userChrome,
    plugins: collectPluginConfigs(pluginSpecs),
    autosave: profiles?.autosave ?? false,
  };
}

function applySettings(s: ProfileSettings): void {
  profiles?.adoptAutosave(s.autosave);
  for (const k of Object.keys(localStorage)) {
    if (/^zoto-viz\.(pong|invaders|command|frogger|cpupong)\./.test(k)) localStorage.removeItem(k);
  }
  for (const [k, v] of Object.entries(s.arcade ?? {})) {
    if (/^zoto-viz\.(pong|invaders|command|frogger|cpupong)\./.test(k)) localStorage.setItem(k, v);
  }
  for (const [mid, opts] of Object.entries(s.modeOptions ?? {})) {
    for (const [k, v] of Object.entries(opts)) localStorage.setItem(`zoto-viz.mode.${mid}.${k}`, v);
  }
  applyPluginConfigs(s.plugins);
  applyTheme(s.theme);
  setDream(s.dream);
  userChrome = parseChrome(s.chrome);
  applyChrome(userChrome, false);
  const show = s.show;
  const keys = ["lan", "internet", "multicast", "offline", "labels"] as const;
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i]!;
    const on = show[key];
    filterToggles[i]!.checked = on;
    scene.setFilters({ [key]: on });
    mosaic?.eachGraph((g) => { if (g !== scene) g.setFilters({ [key]: on }); });
    localStorage.setItem(`zoto-viz.${key}`, on ? "1" : "0");
  }
  mergeToggle.checked = s.merge;
  localStorage.setItem("zoto-viz.merge", s.merge ? "1" : "0");
  setRedaction(s.redact);
  settings.setFilterText(s.filters);
  settings.applyAnim(s.anim);
  settings.applyFeed(s.feed);
  if (activeArcade) {
    arcade[activeArcade].view.stop();
    arcade[activeArcade].el.hidden = true;
    activeArcade = null;
    document.body.classList.remove("arcade");
    scene.setStageOnly(false);
  }
  applyMode(s.mode);
  if (lastRaw) feed(lastRaw);
  void syncWifiWatch();
}

// the panel sits under the header; keep its offset in sync with the header's wrapped height
const bar = $("bar");
new ResizeObserver(() => syncChromeMetrics()).observe(bar);

const LINK_KIND: Record<LinkStatus["kind"], string> = {
  wifi: "Wi-Fi", monitor: "monitor radio", bridge: "bridge", tunnel: "tunnel", ethernet: "Ethernet", gone: "gone",
};
const LED: Record<string, string> = { up: "ok", idle: "warn", degraded: "warn", down: "bad", unknown: "" };

/** Header line: a light per capture interface and one for the gateway, details in the tooltip. */
function renderNetLine(m: StateMsg): void {
  const net = $("net");
  if (!m.links?.length) {  // older monitor without link status
    const extra = (m.interfaces ?? []).filter((i) => i !== m.iface);
    net.textContent = `${m.iface}${extra.length ? ` +${extra.join(", ")}` : ""} · gw ${rIp(m.gateway)}`;
    return;
  }
  const now = m.ts;
  const light = (state: string, title: string, text: string) =>
    `<span class="if ${LED[state] ?? ""}" title="${escapeHtml(title)}"><i class="led"></i>${escapeHtml(text)}</span>`;
  const parts = m.links.map((l) => {
    const bits = [l.name];
    if (l.kind === "wifi") bits.push(l.ssid ? `Wi-Fi ${l.ssid}${l.chan ? ` ch${l.chan}` : ""}` : "Wi-Fi");
    else if (l.kind === "monitor") bits.push(`monitor radio${l.chan ? ` ch${l.chan}` : ""}`);
    else bits.push(LINK_KIND[l.kind] ?? l.kind);
    if (l.addrs.length) bits.push(l.addrs.filter((a) => !a.startsWith("fe80:")).map(rCidr).join(" "));
    if (l.state === "up") bits.push(`${l.pps} frames/s`);
    if (l.why) bits.push(l.why);
    else if (l.last_packet) bits.push(`last frame ${ago(l.last_packet, now)}`);
    return light(l.state, bits.join(" · "), l.name);
  });
  const g = m.gateway_status;
  const gbits = [`gateway ${rIp(m.gateway)}`];
  if (m.network) gbits.push(rCidr(m.network));
  if (!g || g.state === "unknown") gbits.push("not probed yet");
  else {
    gbits.push(g.rtt_ms != null ? `ping ${g.rtt_ms.toFixed(1)} ms` : g.last_ok ? `no ping reply (last ${ago(g.last_ok, now)})` : "no ping reply");
    gbits.push(g.neigh ? `neighbour ${g.neigh}${g.dev ? ` via ${g.dev}` : ""}${g.mac ? ` (${rMac(g.mac)})` : ""}` : "no neighbour entry");
    gbits.push(g.last_packet ? `last packet ${ago(g.last_packet, now)}` : "no packets seen");
  }
  parts.push(light(g?.state ?? "unknown", gbits.join(" · "), `gw ${rIp(m.gateway)}`));
  net.innerHTML = parts.join("");
}

function applyStats(m: StateMsg): void {
  lastState = m;
  renderNetLine(m);
  $("pps").textContent = Math.round(m.stats.pps).toLocaleString();
  $("bps").textContent = fmtBytes(m.stats.bps, true);
  let lan = 0, lanOn = 0, svc = 0, svcOn = 0;
  for (const d of m.devices) {
    if (d.role === "multicast") continue;
    if (d.role === "internet") { svc++; if (d.online) svcOn++; }
    else { lan++; if (d.online) lanOn++; }
  }
  $("lanDevs").textContent = String(lan);
  $("lanOnline").textContent = String(lanOn);
  $("netSvcs").textContent = String(svc);
  $("netOnline").textContent = String(svcOn);
  $("flows").textContent = String(m.stats.flows);
  $("active").textContent = String(m.stats.active_flows);
}

function connect(): void {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const ws = new WebSocket(`${proto}://${location.host}/ws`);
  const dot = $("conn");
  ws.onopen = () => dot.classList.add("ok");
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data) as StateMsg;
    if (m.type !== "state") return;
    feed(m);
  };
  ws.onclose = () => { dot.classList.remove("ok"); setTimeout(connect, 2000); };
  ws.onerror = () => ws.close();
}

connect();

window.addEventListener("keydown", (e) => {
  if (e.target instanceof HTMLSelectElement || e.target instanceof HTMLInputElement || e.target instanceof HTMLButtonElement || e.target instanceof HTMLTextAreaElement) return;
  if (e.key === "Escape" && settings.isOpen) { settings.close(); return; }
  if (e.key === "Escape") scene.select(null);
  if (e.key === "r" || e.key === "R") setRedaction(!redaction.enabled);
  if (e.key === "d" || e.key === "D") setDream(!dreamToggle.checked);
  if (e.key === "f" || e.key === "F") settings.setFeedOn(!settings.feedSettings.on);
  if (e.key === "t" || e.key === "T") applyTheme(THEMES[(THEMES.findIndex((t) => t.id === theme.id) + (e.shiftKey ? THEMES.length - 1 : 1)) % THEMES.length].id);
  const idx = e.key === "0" ? 9 : Number(e.key) - 1;
  if (idx >= 0 && idx < MODES.length && !e.ctrlKey && !e.metaKey && !e.altKey) applyMode(MODES[idx].id);
});
