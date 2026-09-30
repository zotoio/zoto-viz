import { Toggle, TextField, Select, type SelectOption } from "./ui";
import { OddsStrip, TemperRail, clampTemper, parseWeather, setCurrentWeather, type Weather } from "./temper";
import { redaction } from "../core/redact";
import { setTsPluginsAllowed, tsPluginsAllowed } from "../plugins/host";
import { apiFetch, bootSession, csrfToken } from "../core/http";
import { playPcmStream } from "../audio/tts";
import { WakeStream } from "../audio/wake-stream";
import { includeView, VIEW_KEY, type ViewCapture } from "./capture";
import { askUserMedia, clearMediaDismiss } from "./media-ask";
import { micCaptureAllowed } from "../audio/want";
import { soundAllowed } from "../audio/sound";
import { AUTH_SETUPS, renderAuthSetup } from "../core/auth-setup";
import { isNasaStillUrl } from "../core/nasa-stills";
import type { ProfileOperator } from "../core/profiles";

const CONTROL_KEY = "zoto-viz.aiControl";
export const CYCLE_KEY = "zoto-viz.aiCycle";
export const MOSAIC_LAYOUT_KEY = "zoto-viz.ai.mosaicLayout";

/** When false, the model may change tile views but not the split / size / hero. Unset means allowed. */
export function aiMosaicLayoutOn(store: Pick<Storage, "getItem"> | null = typeof localStorage === "undefined" ? null : localStorage): boolean {
  try {
    return store?.getItem(MOSAIC_LAYOUT_KEY) !== "0";
  } catch {
    return true;
  }
}

/** Header AI cycling. Unset means off; only an explicit `"1"` turns it on. */
export function aiCyclePrefOn(store: Pick<Storage, "getItem"> | null = typeof localStorage === "undefined" ? null : localStorage): boolean {
  try {
    return store?.getItem(CYCLE_KEY) === "1";
  } catch {
    return false;
  }
}
const MODEL_KEY = "zoto-viz.aiModel";
const BACKEND_KEY = "zoto-viz.aiBackend";
const CURSOR_MODEL_KEY = "zoto-viz.aiCursorModel";
const VOICE_KEY = "zoto-viz.voice";
const TTS_VOICE_KEY = "zoto-viz.ttsVoice";
const LISTEN_KEY = "zoto-viz.wakeListen";
const WATCH_KEY = "zoto-viz.watchword";
const DEFAULT_WATCH = "zoto";
const SILENCE_MS = 1400;
const HEARD_WAIT_MS = 6000;
const TTS_CAP = 2500;
const STREAM_TTS = new Set(["elevenlabs", "openai", "piper"]);

export type AgentPhase = "idle" | "listen" | "heard" | "think" | "speak";
export type AgentBackend = "ollama" | "cursor";

export interface CatalogRow {
  id: string;
  label: string;
  name?: string;
  sizeGb?: number | null;
  vramGb?: number;
  installed?: boolean;
  pull?: boolean;
  hint?: string;
  warning?: string;
}

export function agentPhase(s: {
  busy: boolean;
  speaking: boolean;
  wakeOn: boolean;
  heard: boolean;
  recOn?: boolean;
}): AgentPhase {
  if (s.speaking) return "speak";
  if (s.busy) return "think";
  if (s.wakeOn && s.heard) return "heard";
  if (s.wakeOn) return "listen";
  return "idle";
}

/** Extra silent /api/ai/chat calls if a turn ends on thought with no user-facing reply. */
export const AGENT_REPLY_POLLS = 1;

export function needsAgentReply(thinking: string, content: string): boolean {
  const text = content.trim();
  if ((text.split("```").length - 1) % 2 === 1) return true;
  if (/<think>/i.test(text) && !/<\/think>/i.test(text)) return true;
  if (!text) return Boolean(thinking.trim());
  return false;
}

const CONTROL_TIP = "AI Control is on — the local agent can change any settings, skies, and decorations (saved on the model-named profile)";
const CYCLE_TIP = "AI cycling on — Dynamic sky, cadence themes, views and motion (profile named after the current model)";

export function agentHeaderCopy(phase: AgentPhase, watch = DEFAULT_WATCH, controlOn = false, cycleOn = false): { text: string; title: string } {
  let text = "AI";
  let title = cycleOn ? CYCLE_TIP : "off — Dynamic sky, cadence themes, views and motion (saved as a profile named after the model)";
  switch (phase) {
    case "speak":
      text = "AI · speak"; title = "speaking a reply"; break;
    case "think":
      text = "AI · think"; title = "the local model is thinking"; break;
    case "heard":
      text = "AI · listen"; title = "heard the watchword — keep talking, then say send"; break;
    case "listen":
      title = `listening for “${watch}”`; break;
    default:
      break;
  }
  if (cycleOn && phase !== "idle") title = `${title} · ${CYCLE_TIP}`;
  if (controlOn) title = `${title} · ${CONTROL_TIP}`;
  return { text, title };
}

export class AgentPanel {
  readonly el: HTMLDivElement;
  readonly headerEl: HTMLElement;
  private readonly headerToggle: Toggle;
  private readonly headerTxt: HTMLSpanElement;
  private readonly led: HTMLSpanElement;
  private readonly input: HTMLTextAreaElement;
  private readonly statusEl: HTMLDivElement;
  private rec: SpeechRec | null = null;
  private wakeStream = new WakeStream();
  private wakeOn = localStorage.getItem(LISTEN_KEY) !== "0";
  private holdTalk = false;
  private busy = false;
  private speaking = false;
  /** Remainder after the watchword in the session that heard it; null = still waiting. */
  private command: string | null = null;
  /** Speech from a later recognition session after the watchword (Chrome restarts often). */
  private follow = "";
  private micBlocked = false;
  /** In-page allow sheet already accepted this listen session. Recognition restarts must not ask again. */
  private wakeAccepted = false;
  /** askUserMedia is in flight. A second startWake would open another sheet. */
  private wakePending = false;
  private silence = 0;
  private restart = 0;
  private controlToggle: Toggle;
  private temperRail!: TemperRail;
  private oddsStrip!: OddsStrip;
  private temperTimer = 0;
  private backendSel!: Select;
  private modelSel!: Select;
  private pullBtn!: HTMLButtonElement;
  private warnEl!: HTMLDivElement;
  private cursorKey!: TextField;
  private cursorHelp!: HTMLElement;
  private ttsHelp!: HTMLElement;
  private listenToggle!: Toggle;
  private voiceToggle!: Toggle;
  private viewToggle!: Toggle;
  private mosaicLayoutToggle!: Toggle;
  private tsToggle!: Toggle;
  private watchField!: TextField;
  private ttsVoiceField!: TextField;
  private history: { role: "user" | "assistant"; content: string; thinking?: string; usage?: Record<string, unknown> }[] = [];
  private hydrateP: Promise<void> | null = null;
  private logEpoch = 0;
  private noVoiceHint = false;
  private voicesTried = false;
  private ttsEngine = "";
  private lastOllama: { ok: boolean; models: string[] } = { ok: false, models: [] };
  private lastCursor = { ok: false, configured: false, models: [] as { id: string; label: string; hint?: string }[] };
  private catalog: CatalogRow[] = [];
  private pulling = false;
  private speakAbort: AbortController | null = null;
  private spoken = "";
  private speakQ: string[] = [];
  private speakRunning = false;
  private liveVoice = false;
  /** After “zoto stop”, TTS stays off until the watchword is heard again. */
  private speakMuted = false;
  private displayCaughtUp = true;
  private heardFeed = false;
  private speechWait: (() => void) | null = null;
  onControl?: (on: boolean) => void;
  onCycle?: (on: boolean) => void;
  /** Backend, model, or key changed — write them onto the open profile. */
  onPrefs?: () => void;
  onOpen?: () => void;
  onApplySettings?: (patch: Record<string, unknown>) => void | Promise<void>;
  onApplyLook?: (look: AgentLookInput) => Promise<void>;
  onChat?: (role: "you" | "think" | "agent", text: string, stream?: boolean) => void;
  /** Called when the model has no more tokens for this turn. */
  onChatEnd?: () => void;
  onPhase?: (phase: AgentPhase) => void;
  onTranscript?: () => void;
  /** Overlay transcript box; hold-to-talk and send prefer it when present. */
  dictateInto: HTMLTextAreaElement | null = null;
  /** Compact HUD for this turn (not stored in the transcript). */
  captureView?: () => ViewCapture | null;

  constructor() {
    this.el = document.createElement("div");
    this.el.className = "agent-panel";
    this.led = document.createElement("span");
    this.led.className = "led";
    this.led.setAttribute("aria-hidden", "true");
    this.headerToggle = new Toggle({
      id: "ai",
      label: "AI",
      title: CYCLE_TIP,
      checked: aiCyclePrefOn(),
      onChange: (on) => { this.onCycle?.(on); },
    });
    this.headerTxt = this.headerToggle.el.querySelector(".txt")!;
    this.headerToggle.el.prepend(this.led);
    this.headerEl = this.headerToggle.el;
    document.addEventListener("pointerdown", (ev) => {
      if (!micCaptureAllowed()) return;
      const t = ev.target;
      // pointerdown on Allow / Not now fires before the dialog closes and would queue another ask.
      if (t instanceof Element && t.closest("[data-media-ask]")) return;
      if (this.wakeOn && !this.micBlocked && !this.rec && !this.holdTalk && !this.wakePending) this.startWake();
    });

    this.statusEl = document.createElement("div");
    this.statusEl.className = "sec-hint";
    this.statusEl.textContent = "Local Ollama or Cursor SDK";

    const control = new Toggle({
      label: "AI Control",
      title: "when on, the agent may change settings and install drafted plugins. The header AI toggle also turns this on with a profile named after the model.",
      checked: false,
      onChange: (on) => { void this.pushControl(on); },
    });
    this.controlToggle = control;
    document.body.classList.toggle("ai-control", control.checked);

    const ts = this.tsToggle = new Toggle({
      label: "allow TypeScript plugins",
      title: "compile and run sandboxed entry.ts after you confirm you wrote or reviewed the source",
      checked: tsPluginsAllowed(),
      onChange: (on) => { setTsPluginsAllowed(on); this.onPrefs?.(); },
    });

    const listen = this.listenToggle = new Toggle({
      label: "listen for watchword",
      title: "hold a live mic stream; after the watchword, talk, then say send — or zoto stop to cut speech",
      checked: this.wakeOn,
      onChange: (on) => {
        this.wakeOn = on;
        localStorage.setItem(LISTEN_KEY, on ? "1" : "0");
        if (on) {
          clearMediaDismiss("mic");
          this.micBlocked = false;
          if (micCaptureAllowed()) this.startWake(true);
        }
        else this.stopWake();
        this.paintHeader();
        this.onPrefs?.();
      },
    });

    const voice = this.voiceToggle = new Toggle({
      label: "speak replies",
      title: "read agent replies through the speakers (ElevenLabs / Kokoro / Piper stream, else espeak). Header sound must be on. Say zoto stop to halt until the watchword again",
      checked: localStorage.getItem(VOICE_KEY) !== "0",
      onChange: (on) => { localStorage.setItem(VOICE_KEY, on ? "1" : "0"); this.onPrefs?.(); },
    });

    const watch = this.watchField = new TextField({
      caption: "watchword",
      title: "always-on listening waits for this word (also ‘hey …’ / ‘okay …’); say send after the question, or zoto stop to cut speech",
      value: localStorage.getItem(WATCH_KEY) || DEFAULT_WATCH,
      placeholder: DEFAULT_WATCH,
      onInput: (v) => { localStorage.setItem(WATCH_KEY, v.trim() || DEFAULT_WATCH); this.onPrefs?.(); },
    });

    const view = this.viewToggle = new Toggle({
      label: "include screen",
      title: "attach a JPEG of the live canvas plus a compact HUD of mode, theme, and stats",
      checked: includeView(),
      onChange: (on) => { localStorage.setItem(VIEW_KEY, on ? "1" : "0"); this.onPrefs?.(); },
    });
    const mosaicLayout = this.mosaicLayoutToggle = new Toggle({
      label: "AI mosaic layout",
      title: "On: the model may resize, rearrange, close, or change the mosaic grid. Off: it may only change which views sit in the existing tiles.",
      checked: aiMosaicLayoutOn(),
      onChange: (on) => { localStorage.setItem(MOSAIC_LAYOUT_KEY, on ? "1" : "0"); this.onPrefs?.(); },
    });

    this.backendSel = new Select({
      caption: "backend",
      title: "Ollama on this machine, or Cursor SDK (Grok by default)",
      value: (localStorage.getItem(BACKEND_KEY) === "cursor" ? "cursor" : "ollama"),
      options: [
        { value: "ollama", label: "Ollama", hint: "installed local tags" },
        { value: "cursor", label: "Cursor SDK", hint: "hosted models, default Grok" },
      ],
      onChange: (v) => {
        localStorage.setItem(BACKEND_KEY, v);
        this.paintModels();
        this.paintCursorKey();
        void this.refreshStatus();
        this.onPrefs?.();
      },
    });
    this.modelSel = new Select({
      caption: "model",
      title: "Installed Ollama tags, popular pulls, or Cursor SDK models",
      filterable: true,
      value: localStorage.getItem(MODEL_KEY) || "gemma4",
      options: [{ value: localStorage.getItem(MODEL_KEY) || "gemma4", label: localStorage.getItem(MODEL_KEY) || "gemma4" }],
      onChange: (v) => {
        if (this.backend === "cursor") localStorage.setItem(CURSOR_MODEL_KEY, v);
        else localStorage.setItem(MODEL_KEY, v);
        this.paintPull();
        this.onPrefs?.();
      },
    });
    this.pullBtn = document.createElement("button");
    this.pullBtn.type = "button";
    this.pullBtn.className = "agent-pull";
    this.pullBtn.textContent = "download";
    this.pullBtn.hidden = true;
    this.pullBtn.addEventListener("click", () => void this.pullSelected());
    this.warnEl = document.createElement("div");
    this.warnEl.className = "sec-hint agent-warn";
    this.cursorKey = new TextField({
      caption: "Cursor API key",
      title: "CURSOR_API_KEY, or paste a user / service-account key (stored in ~/.zoto-viz/cursor-key)",
      value: "",
      placeholder: "cursor_…",
      onInput: () => { /* saved on blur / apply */ },
    });
    this.cursorKey.input.type = "password";
    this.cursorKey.input.autocomplete = "off";
    this.cursorKey.input.addEventListener("change", () => void this.saveCursorKey());
    const ttsVoice = this.ttsVoiceField = new TextField({
      caption: "TTS voice",
      title: "ElevenLabs voice id, or Kokoro name (af_heart). Empty uses the monitor default.",
      value: localStorage.getItem(TTS_VOICE_KEY) || "",
      placeholder: "af_heart",
      onInput: (v) => { localStorage.setItem(TTS_VOICE_KEY, v.trim()); this.onPrefs?.(); },
    });

    this.temperRail = new TemperRail({
      onChange: (n) => { this.pushTemper({ temper: n }); this.onPrefs?.(); },
    });
    this.oddsStrip = new OddsStrip({
      onChange: (w) => {
        setCurrentWeather(w);
        this.pushTemper({ weather: w });
        this.onPrefs?.();
      },
    });
    setCurrentWeather(this.oddsStrip.value);

    this.input = document.createElement("textarea");
    this.input.hidden = true;
    this.input.setAttribute("aria-hidden", "true");
    const clear = document.createElement("button");
    clear.type = "button";
    clear.textContent = "clear conversation";
    clear.title = "clear the feed transcript and outcome facts (memories stay)";
    clear.addEventListener("click", () => void this.clearHistory());
    const row = document.createElement("div");
    row.className = "agent-row";
    row.append(this.pullBtn, clear);

    this.cursorHelp = renderAuthSetup(AUTH_SETUPS.cursor);
    this.ttsHelp = renderAuthSetup(AUTH_SETUPS.elevenlabs);
    this.el.append(
      this.statusEl,
      this.temperRail.el,
      this.oddsStrip.el,
      this.backendSel.el, this.modelSel.el, this.warnEl, this.cursorKey.el, this.cursorHelp,
      ttsVoice.el, this.ttsHelp, control.el, listen.el, watch.el, voice.el, ts.el, view.el, mosaicLayout.el, row, this.input,
    );
    this.paintCursorKey();
    this.paintPull();
    this.paintHeader();
    void this.refreshStatus();
    void this.hydrate();
    if ("speechSynthesis" in window) {
      speechSynthesis.getVoices();
      speechSynthesis.addEventListener("voiceschanged", () => speechSynthesis.getVoices());
    }
  }

  get controlOn(): boolean { return this.controlToggle.checked; }
  get cycleOn(): boolean { return this.headerToggle.checked; }
  get backend(): AgentBackend {
    return this.backendSel?.value === "cursor" ? "cursor" : "ollama";
  }
  get modelTag(): string {
    if (this.backend === "cursor") {
      return this.modelSel?.value.trim() || localStorage.getItem(CURSOR_MODEL_KEY) || "grok-4.5";
    }
    return this.modelSel?.value.trim() || localStorage.getItem(MODEL_KEY) || "gemma4";
  }

  cursorReady(): boolean { return this.lastCursor.configured; }

  async probeOllama(): Promise<{ ok: boolean; model: string; models: string[]; online: boolean }> {
    await this.refreshStatus();
    const model = this.modelTag;
    if (this.backend === "cursor") {
      const online = this.lastCursor.configured;
      return { ok: this.lastCursor.ok || online, model, models: this.lastCursor.models.map((m) => m.id), online };
    }
    const online = this.lastOllama.ok && (
      this.lastOllama.models.length ? this.lastOllama.models.some((n) => n === model || n.startsWith(model + ":")) : true
    );
    return { ok: this.lastOllama.ok, model, models: this.lastOllama.models, online };
  }

  /** Set the header switch without firing onCycle. */
  setCycleChecked(on: boolean): void {
    this.headerToggle.checked = on;
    try { localStorage.setItem(CYCLE_KEY, on ? "1" : "0"); } catch { /* private mode */ }
    this.paintHeader();
  }

  /** Backend, model, and header AI as stored on the profile. The key stays on the monitor. */
  aiPrefs(): { backend: "" | "ollama" | "cursor"; model: string; cursorModel: string; cycle: boolean } {
    const backend = this.backendSel?.value === "cursor" ? "cursor" : (this.backendSel?.value === "ollama" ? "ollama" : "");
    return {
      backend,
      model: localStorage.getItem(MODEL_KEY) || "",
      cursorModel: localStorage.getItem(CURSOR_MODEL_KEY) || "",
      cycle: this.cycleOn,
    };
  }

  private profileBackend: "" | "ollama" | "cursor" = "";

  /** Backend last applied from a profile. Empty means the file never recorded one. */
  savedBackend(): "" | "ollama" | "cursor" { return this.profileBackend; }

  /** Apply a profile's agent block. Does not start header AI (that switches profiles). */
  applyAi(ai: { backend?: string; model?: string; cursorModel?: string; cycle?: boolean }): void {
    this.profileBackend = ai.backend === "cursor" || ai.backend === "ollama" ? ai.backend : "";
    if (ai.backend === "cursor" || ai.backend === "ollama") {
      localStorage.setItem(BACKEND_KEY, ai.backend);
      this.backendSel.value = ai.backend;
    }
    if (ai.model) localStorage.setItem(MODEL_KEY, ai.model);
    if (ai.cursorModel) localStorage.setItem(CURSOR_MODEL_KEY, ai.cursorModel);
    this.setCycleChecked(ai.cycle === true);
    this.paintModels();
    this.paintCursorKey();
  }

  /** Operator toggles last managed on this profile (voice, listen, temper, debug stays outside). */
  operatorPrefs(): ProfileOperator {
    return {
      voice: this.voiceToggle.checked,
      listen: this.listenToggle.checked,
      watchword: this.watchField.value.trim() || DEFAULT_WATCH,
      ttsVoice: this.ttsVoiceField.value.trim(),
      includeScreen: this.viewToggle.checked,
      mosaicLayout: this.mosaicLayoutToggle.checked,
      tsPlugins: this.tsToggle.checked,
      temper: this.temper,
      weather: this.weather,
      tileHealErrors: false,
      debug: false,
    };
  }

  /** Restore operator toggles from a profile without treating them as fresh edits. */
  applyOperator(op: ProfileOperator): void {
    this.voiceToggle.checked = op.voice;
    localStorage.setItem(VOICE_KEY, op.voice ? "1" : "0");
    this.listenToggle.checked = op.listen;
    this.wakeOn = op.listen;
    localStorage.setItem(LISTEN_KEY, op.listen ? "1" : "0");
    if (op.listen) {
      if (micCaptureAllowed()) this.startWake();
    } else this.stopWake();
    this.watchField.value = op.watchword || DEFAULT_WATCH;
    localStorage.setItem(WATCH_KEY, op.watchword || DEFAULT_WATCH);
    this.ttsVoiceField.value = op.ttsVoice;
    localStorage.setItem(TTS_VOICE_KEY, op.ttsVoice);
    this.viewToggle.checked = op.includeScreen;
    localStorage.setItem(VIEW_KEY, op.includeScreen ? "1" : "0");
    this.mosaicLayoutToggle.checked = op.mosaicLayout;
    localStorage.setItem(MOSAIC_LAYOUT_KEY, op.mosaicLayout ? "1" : "0");
    this.tsToggle.checked = op.tsPlugins;
    setTsPluginsAllowed(op.tsPlugins);
    this.syncTemper({ temper: op.temper, weather: op.weather });
    this.pushTemper({ temper: op.temper, weather: this.weather });
    this.paintHeader();
  }

  /** Show Cursor when the monitor already has a key and this profile never chose a backend. */
  useBackend(backend: "ollama" | "cursor"): void {
    localStorage.setItem(BACKEND_KEY, backend);
    this.backendSel.value = backend;
    this.paintModels();
    this.paintCursorKey();
  }

  syncStatus(): Promise<void> {
    return this.refreshStatus();
  }

  async setControl(on: boolean): Promise<void> {
    await this.pushControl(on);
  }

  setControlFromServer(on: boolean): void {
    this.controlToggle.checked = on;
    localStorage.setItem(CONTROL_KEY, on ? "1" : "0");
    document.body.classList.toggle("ai-control", on);
    this.paintHeader();
    this.onControl?.(on);
  }

  /** Apply temper/weather from MCP or the monitor without echoing a PUT. */
  syncTemper(patch: { temper?: number; weather?: string }): void {
    if (typeof patch.temper === "number") {
      this.temperRail.value = clampTemper(patch.temper);
      try { localStorage.setItem("zoto-viz.temper", String(this.temperRail.value)); } catch { /* ignore */ }
    }
    if (patch.weather) {
      const w = parseWeather(patch.weather);
      this.oddsStrip.value = w;
      setCurrentWeather(w);
    }
  }

  get weather(): Weather { return this.oddsStrip.value; }
  get temper(): number { return this.temperRail.value; }

  /** Start always-on listening if the operator left the toggle on. Needs a click if the browser blocks it. */
  armWake(): void {
    void this.refreshStatus();
    void this.hydrate();
    if (this.wakeOn && micCaptureAllowed()) this.startWake();
    else if (!micCaptureAllowed()) this.releaseMic();
  }

  /** Header mic Off — stop watchword / hold-to-talk so the OS mic light goes out. */
  releaseMic(): void {
    this.holdTalk = false;
    this.stopWake();
  }

  private async pushControl(on: boolean): Promise<void> {
    try {
      const r = await apiFetch("/api/ai/control", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ on }),
      });
      const d = await r.json() as { aiControl?: boolean; error?: string };
      if (!r.ok) {
        this.controlToggle.checked = !on;
        this.append("agent", d.error || `AI Control failed (${r.status})`);
        return;
      }
      this.setControlFromServer(!!d.aiControl);
    } catch {
      this.controlToggle.checked = !on;
    }
  }

  private pushTemper(patch: { temper?: number; weather?: Weather }): void {
    if (typeof patch.temper === "number") {
      try { localStorage.setItem("zoto-viz.temper", String(clampTemper(patch.temper))); } catch { /* ignore */ }
    }
    if (patch.weather) setCurrentWeather(patch.weather);
    window.clearTimeout(this.temperTimer);
    this.temperTimer = window.setTimeout(() => {
      void apiFetch("/api/ai/temper", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          temper: this.temperRail.value,
          weather: this.oddsStrip.value,
        }),
      }).catch(() => {});
    }, 120);
  }

  mountSettings(host: HTMLElement): void {
    host.appendChild(this.el);
  }

  private async refreshStatus(): Promise<void> {
    try {
      const r = await apiFetch("/api/ai/status");
      if (!r.ok) {
        this.lastOllama = { ok: false, models: [] };
        this.statusEl.textContent = r.status === 404
          ? "This monitor has no AI routes — restart the monitor process to load the current code."
          : `AI status failed (${r.status}).`;
        return;
      }
      const d = await r.json() as {
        ok?: boolean; error?: string; hasGemma?: boolean; model?: string; host?: string; models?: string[]; tts?: string;
        temper?: number; weather?: string;
        ollama?: { ok?: boolean; host?: string; error?: string; catalog?: CatalogRow[]; vramGb?: number | null; gpu?: string | null };
        cursor?: { ok?: boolean; configured?: boolean; default?: string; error?: string; models?: { id?: string; label?: string; hint?: string }[] };
      };
      this.ttsEngine = String(d.tts || "");
      this.lastOllama = {
        ok: !!(d.ollama?.ok ?? d.ok),
        models: Array.isArray(d.models) ? d.models.filter((m) => typeof m === "string") : [],
      };
      this.catalog = Array.isArray(d.ollama?.catalog) ? d.ollama.catalog : [];
      this.lastCursor = {
        ok: !!d.cursor?.ok,
        configured: !!d.cursor?.configured,
        models: (d.cursor?.models || []).filter((m) => m.id).map((m) => ({
          id: String(m.id),
          label: String(m.label || m.id),
          hint: m.hint,
        })),
      };
      if (typeof d.temper === "number" || d.weather) this.syncTemper({ temper: d.temper, weather: d.weather });
      this.paintModels();
      const listen = this.wakeOn ? `Listening for “${watchword()}”.` : "Watchword listening is off.";
      const tts = this.ttsEngine ? ` TTS ${this.ttsEngine}.` : "";
      const vram = d.ollama?.vramGb != null ? ` GPU ${d.ollama.vramGb} GB${d.ollama.gpu ? ` (${d.ollama.gpu})` : ""}.` : "";
      if (this.backend === "cursor") {
        this.statusEl.textContent = d.cursor?.configured
          ? `Cursor SDK · ${this.modelTag}.${d.cursor.ok ? "" : ` ${d.cursor.error || "model list unavailable"}`.trim()}${tts} ${listen}`
          : `Cursor SDK needs a key (CURSOR_API_KEY or Settings). ${d.cursor?.error || ""}`.trim();
      } else {
        this.statusEl.textContent = this.lastOllama.ok
          ? `Ollama ${d.ollama?.host || d.host || "127.0.0.1:11434"} · ${this.modelTag}.${vram}${tts} ${listen}`
          : `Ollama offline (${d.ollama?.error || d.error || "unreachable"}).${vram}`;
      }
    } catch {
      this.lastOllama = { ok: false, models: [] };
      this.statusEl.textContent = "Agent status unknown — is the monitor up?";
    }
  }

  private paintCursorKey(): void {
    this.cursorKey.hidden = this.backend !== "cursor";
    const saved = this.lastCursor.configured;
    this.cursorKey.input.placeholder = saved ? "key saved on the monitor" : "cursor_…";
    const cap = this.cursorKey.el.querySelector(".cap");
    if (cap) cap.textContent = saved ? "Cursor API key · saved" : "Cursor API key";
    if (this.cursorHelp) this.cursorHelp.hidden = this.backend !== "cursor" || saved;
    if (this.ttsHelp) this.ttsHelp.hidden = this.ttsEngine === "elevenlabs";
  }

  private paintModels(): void {
    if (this.backend === "cursor") {
      const saved = localStorage.getItem(CURSOR_MODEL_KEY) || "";
      const listed = this.lastCursor.models.length
        ? this.lastCursor.models
        : [{ id: saved || "grok-4.6", label: saved || "Grok 4.6", hint: "default" }];
      let opts: SelectOption[] = listed.map((m) => ({ value: m.id, label: m.label, hint: m.hint, group: "Cursor" }));
      if (saved && !opts.some((o) => o.value === saved)) {
        opts = [{ value: saved, label: saved, group: "Cursor" }, ...opts];
      }
      this.modelSel.setOptions(opts);
      const want = saved || listed.find((m) => /^grok/i.test(m.id))?.id || opts[0]?.value || "grok-4.6";
      this.modelSel.value = opts.some((o) => o.value === want) ? want : (opts[0]?.value || want);
      if (this.modelSel.value) localStorage.setItem(CURSOR_MODEL_KEY, this.modelSel.value);
    } else {
      const opts = this.ollamaOptions();
      this.modelSel.setOptions(opts);
      const want = localStorage.getItem(MODEL_KEY) || "gemma4";
      const hit = opts.find((o) => o.value === want) || opts.find((o) => o.value.startsWith(`${want}:`)) || opts[0];
      this.modelSel.value = hit?.value || want;
      localStorage.setItem(MODEL_KEY, this.modelSel.value);
    }
    this.paintCursorKey();
    this.paintPull();
  }

  private ollamaOptions(): SelectOption[] {
    const rows = this.catalog.length
      ? this.catalog
      : this.lastOllama.models.map((name) => ({ id: name, label: name, name, installed: true, pull: false }));
    const installed = rows.filter((r) => r.installed);
    const pulls = rows.filter((r) => !r.installed);
    const hint = (r: CatalogRow) => {
      const size = r.sizeGb != null ? `${r.sizeGb} GB` : "";
      const vram = r.vramGb != null ? `~${r.vramGb} GB VRAM` : "";
      const warn = r.warning ? ` · ${r.warning}` : "";
      return [r.installed ? "installed" : "download", size, vram].filter(Boolean).join(" · ") + warn;
    };
    return [
      ...installed.map((r) => ({ value: r.name || r.id, label: r.label || r.id, hint: hint(r), group: "Installed" })),
      ...pulls.map((r) => ({ value: r.id, label: r.label || r.id, hint: hint(r), group: "Download" })),
    ];
  }

  private selectedCatalog(): CatalogRow | undefined {
    const id = this.modelSel.value;
    return this.catalog.find((r) => r.id === id || r.name === id);
  }

  private paintPull(): void {
    const row = this.selectedCatalog();
    const need = this.backend === "ollama" && !!row?.pull;
    this.pullBtn.hidden = !need;
    this.pullBtn.disabled = this.pulling;
    this.pullBtn.textContent = this.pulling ? "downloading…" : "download";
    this.warnEl.textContent = row?.warning && need ? row.warning : "";
  }

  private async saveCursorKey(): Promise<void> {
    const key = this.cursorKey.value.trim();
    if (!key) return;
    try {
      if (!csrfToken()) await bootSession();
      const r = await apiFetch("/api/ai/cursor", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ key }),
      });
      const d = await r.json() as { error?: string };
      this.cursorKey.value = "";
      if (!r.ok) this.note(d.error || `Cursor key failed (${r.status})`);
      await this.refreshStatus();
      this.onPrefs?.();
    } catch (e) {
      this.note(String(e));
    }
  }

  private async pullSelected(): Promise<void> {
    const name = this.selectedCatalog()?.id || this.modelSel.value;
    if (!name || this.pulling) return;
    const row = this.selectedCatalog();
    if (row?.warning && !window.confirm(`${row.warning}\n\nDownload ${name} anyway?`)) return;
    this.pulling = true;
    this.paintPull();
    this.note(`downloading ${name}…`);
    try {
      if (!csrfToken()) await bootSession();
      const r = await apiFetch("/api/ai/ollama/pull", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!r.ok) {
        this.note(`pull failed (${r.status})`);
        return;
      }
      const reader = r.body?.getReader();
      const dec = new TextDecoder();
      let buf = "";
      let last = "";
      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          const lines = buf.split("\n");
          buf = lines.pop() ?? "";
          for (const line of lines) {
            try {
              const j = JSON.parse(line) as { status?: string; error?: string; completed?: number; total?: number };
              if (j.error) { last = j.error; break; }
              if (j.status) last = j.total ? `${j.status} ${Math.round(100 * (j.completed || 0) / j.total)}%` : j.status;
            } catch { /* ignore */ }
          }
        }
      }
      this.note(last && !/success/i.test(last) ? `${name}: ${last}` : `${name} is ready`);
      await this.refreshStatus();
    } catch (e) {
      this.note(String(e));
    } finally {
      this.pulling = false;
      this.paintPull();
    }
  }

  transcript(): { role: "user" | "assistant"; content: string; thinking?: string; usage?: Record<string, unknown> }[] {
    return this.history.slice();
  }

  private note(text: string): void {
    if (!text) return;
    this.onChat?.("agent", text);
  }

  private append(role: string, text: string): void {
    if (role === "you" || role === "think" || role === "agent") {
      this.onChat?.(role, text);
    }
  }

  private async hydrate(force = false): Promise<void> {
    if (this.busy) return;
    if (!force && this.hydrateP) return this.hydrateP;
    const epoch = this.logEpoch;
    const run = (async () => {
      try {
        if (!csrfToken()) await bootSession();
        const r = await apiFetch("/api/ai/history");
        if (!r.ok) return;
        const d = await r.json() as { messages?: { role?: string; content?: string; thinking?: string; usage?: Record<string, unknown> }[] };
        if (!Array.isArray(d.messages)) return;
        if (epoch !== this.logEpoch) return;
        this.history = d.messages
          .filter((m) => m.role === "user" || m.role === "assistant")
          .map((m) => ({
            role: m.role as "user" | "assistant",
            content: String(m.content || ""),
            thinking: m.thinking ? String(m.thinking) : undefined,
            usage: m.usage && typeof m.usage === "object" ? m.usage : undefined,
          }));
        this.onTranscript?.();
      } catch { /* monitor may still be coming up */ }
    })();
    this.hydrateP = run;
    return run;
  }

  private async clearHistory(): Promise<void> {
    this.logEpoch += 1;
    this.history = [];
    this.onTranscript?.();
    try {
      if (!csrfToken()) await bootSession();
      await apiFetch("/api/ai/history", { method: "DELETE" });
    } catch { /* local log already cleared */ }
  }

  private paintHeader(): void {
    const phase = agentPhase({
      busy: this.busy,
      speaking: this.speaking,
      wakeOn: this.wakeOn,
      heard: this.command !== null,
      recOn: !!this.rec,
    });
    const { text, title } = agentHeaderCopy(phase, watchword(), this.controlOn, this.cycleOn);
    this.headerEl.classList.toggle("listening", phase === "listen");
    this.headerEl.classList.toggle("heard", phase === "heard");
    this.headerEl.classList.toggle("thinking", phase === "think");
    this.headerEl.classList.toggle("speaking", phase === "speak");
    this.headerEl.classList.toggle("busy", phase === "think" || phase === "speak");
    this.headerEl.setAttribute("aria-busy", phase === "think" || phase === "speak" ? "true" : "false");
    this.headerEl.title = title;
    this.headerTxt.textContent = text;
    document.body.classList.toggle("ai-thinking", phase === "think");
    this.onPhase?.(phase);
  }

  private speechEngine(): (new () => SpeechRec) | null {
    const w = window as unknown as { SpeechRecognition?: new () => SpeechRec; webkitSpeechRecognition?: new () => SpeechRec };
    return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
  }

  private startWake(restart = false): void {
    if (this.wakePending) return;
    if (this.micBlocked && !restart) return;
    void this.armListen(restart);
  }

  /** Hold one MediaStream for the whole listen session; SpeechRecognition may restart on it. */
  private async armListen(restart = false): Promise<void> {
    if (!micCaptureAllowed() || !this.wakeOn || this.holdTalk) return;
    if (this.micBlocked && !restart) return;
    if (this.wakePending) return;
    if (this.rec && !restart) return;
    const SR = this.speechEngine();
    if (!SR) {
      this.wakeStream.disable();
      if (restart) this.append("agent", "this browser has no speech recognition — Chromium on localhost is required");
      return;
    }
    // SpeechRecognition ends and restarts often. The stream is already held, or the operator
    // already accepted the sheet; asking again reopens the allow dialog and stalls the canvas.
    if (this.wakeStream.live || this.wakeAccepted) {
      this.attachWakeRec(SR);
      return;
    }
    this.wakePending = true;
    try {
      const stream = await askUserMedia({ audio: true, video: false }, "watchword listening");
      if (!stream || !micCaptureAllowed() || !this.wakeOn) {
        if (stream) for (const t of stream.getTracks()) t.stop();
        this.wakeStream.disable();
        if (!stream && this.wakeOn && micCaptureAllowed()) this.micBlocked = true;
        return;
      }
      if (this.holdTalk) {
        for (const t of stream.getTracks()) t.stop();
        return;
      }
      if (this.rec && !restart) {
        for (const t of stream.getTracks()) t.stop();
        return;
      }
      const open = await this.wakeStream.enable(stream);
      if (!this.wakeOn || !micCaptureAllowed()) {
        this.wakeStream.disable();
        return;
      }
      if (this.holdTalk) return;
      if (this.rec && !restart) return;
      if (!open) {
        this.micBlocked = true;
        this.headerEl.title = "allow the microphone on the in-page prompt (this window has no browser listening dialog)";
        return;
      }
      this.wakeAccepted = true;
      this.attachWakeRec(SR);
    } finally {
      this.wakePending = false;
    }
  }

  private attachWakeRec(SR: new () => SpeechRec): void {
    window.clearTimeout(this.restart);
    this.stopRec();
    unlockSpeech();
    const rec = new SR();
    rec.lang = "en-US";
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 5;
    rec.onresult = (e) => this.onHear(e);
    rec.onerror = (e) => {
      if (e.error === "no-speech" || e.error === "aborted") return;
      if (e.error === "not-allowed") {
        this.micBlocked = true;
        this.headerEl.title = "allow the microphone on the in-page prompt (this window has no browser listening dialog)";
      }
    };
    rec.onend = () => {
      if (this.rec !== rec) return;
      this.rec = null;
      this.paintHeader();
      if (this.wakeOn && micCaptureAllowed() && !this.holdTalk && !this.micBlocked && (this.wakeStream.live || this.wakeAccepted)) {
        this.restart = window.setTimeout(() => this.startWake(), 250);
      }
    };
    try {
      rec.start();
      this.rec = rec;
      this.micBlocked = false;
      this.paintHeader();
    } catch {
      this.headerEl.title = "allow the microphone on the in-page prompt (browser blocked the mic)";
    }
  }

  private stopWake(): void {
    this.command = null;
    this.follow = "";
    window.clearTimeout(this.silence);
    window.clearTimeout(this.restart);
    this.stopRec();
    this.wakeStream.disable();
    this.paintHeader();
  }

  private stopRec(): void {
    const rec = this.rec;
    this.rec = null;
    try { rec?.abort(); } catch { /* already stopped */ }
  }

  private startHold(): void {
    this.holdTalk = true;
    window.clearTimeout(this.silence);
    this.command = null;
    this.follow = "";
    this.stopRec();
    void this.armHold();
  }

  private async armHold(): Promise<void> {
    if (!micCaptureAllowed()) { this.holdTalk = false; return; }
    const SR = this.speechEngine();
    if (!SR) { this.append("agent", "this browser has no speech recognition"); this.holdTalk = false; return; }
    clearMediaDismiss("mic");
    const stream = await askUserMedia({ audio: true, video: false }, "hold to talk");
    if (!stream || !this.holdTalk || !micCaptureAllowed()) {
      if (stream) for (const t of stream.getTracks()) t.stop();
      this.holdTalk = false;
      if (!stream && micCaptureAllowed()) {
        this.append("agent", "allow the microphone on the in-page prompt — this window has no browser listening dialog");
      }
      return;
    }
    await this.wakeStream.enable(stream);
    const rec = new SR();
    rec.lang = "en-US";
    rec.interimResults = true;
    rec.continuous = false;
    rec.onresult = (e) => {
      const t = lastTranscript(e);
      if (t) this.draftBox().value = t;
    };
    rec.onend = () => { this.rec = null; };
    try { rec.start(); this.rec = rec; } catch { this.holdTalk = false; }
  }

  private stopHold(): void {
    if (!this.holdTalk) return;
    this.holdTalk = false;
    this.rec?.stop();
    this.rec = null;
    if (!this.wakeOn) this.wakeStream.disable();
    void this.send().then(() => { if (this.wakeOn && micCaptureAllowed()) this.startWake(); });
  }

  private onHear(e: SpeechResultEvent): void {
    if (this.holdTalk) return;
    const word = watchword();
    const said = sessionTranscript(e, word);
    if (!said) return;
    const attentive = this.speaking || this.busy || this.command !== null;
    if (isSpeakStop(said, word, attentive)) {
      this.haltSpeak();
      return;
    }
    if (this.busy || this.speaking) return;
    const rest = afterWatchword(said, word);
    if (rest !== null) this.speakMuted = false;
    if (this.command === null) {
      if (rest === null) return;
      this.command = rest;
      this.follow = "";
      this.paintHeader();
    } else if (rest !== null) {
      this.command = rest;
      this.follow = "";
    } else {
      this.follow = said;
    }
    const raw = `${this.command || ""} ${this.follow}`.trim();
    const { body, send } = afterSendCue(raw);
    this.draftBox().value = body;
    window.clearTimeout(this.silence);
    if (send) {
      this.silence = window.setTimeout(() => void this.flushCommand(), SILENCE_MS);
    } else if (!body) {
      this.silence = window.setTimeout(() => {
        this.command = null;
        this.follow = "";
        this.draftBox().value = "";
        this.paintHeader();
      }, HEARD_WAIT_MS);
    }
  }

  private async flushCommand(): Promise<void> {
    const raw = `${this.command || ""} ${this.follow}`.trim();
    const { body } = afterSendCue(raw);
    this.command = null;
    this.follow = "";
    this.paintHeader();
    if (!body) return;
    this.input.value = body;
    this.draftBox().value = body;
    await this.send(body);
  }

  beginTalk(): void { this.startHold(); }
  endTalk(): void { this.stopHold(); }

  stopVoice(): void {
    this.holdTalk = false;
    this.stopWake();
    this.resetSpeech();
    if ("speechSynthesis" in window) speechSynthesis.cancel();
    void apiFetch("/api/ai/speak", { method: "DELETE" });
  }

  /** Cut speaker output without muting until the watchword (header sound Off). */
  hushOutput(): void {
    this.resetSpeech();
    if ("speechSynthesis" in window) speechSynthesis.cancel();
    void apiFetch("/api/ai/speak", { method: "DELETE" });
  }

  /** Cut TTS now and keep it off until the watchword is heard again. */
  private haltSpeak(): void {
    this.speakMuted = true;
    this.liveVoice = false;
    this.resetSpeech();
    if ("speechSynthesis" in window) speechSynthesis.cancel();
    void apiFetch("/api/ai/speak", { method: "DELETE" });
    this.command = null;
    this.follow = "";
    this.draftBox().value = "";
    window.clearTimeout(this.silence);
    this.paintHeader();
  }

  private draftBox(): HTMLTextAreaElement {
    return this.dictateInto ?? this.input;
  }

  private takeDraft(explicit?: string): string {
    const text = (explicit !== undefined ? explicit : (this.dictateInto?.value || this.input.value)).trim();
    this.input.value = "";
    if (this.dictateInto) this.dictateInto.value = "";
    return text;
  }

  async sendText(text: string): Promise<void> {
    if (isSpeakStop(text, watchword(), true)) {
      this.haltSpeak();
      return;
    }
    await this.send(text);
  }

  /** False if a turn is already in flight — the ticker keeps the draft. */
  offerSend(text: string): boolean {
    if (isSpeakStop(text, watchword(), true)) {
      this.haltSpeak();
      return true;
    }
    if (this.busy) return false;
    void this.send(text);
    return true;
  }

  private async send(explicit?: string): Promise<boolean> {
    if (this.busy) return false;
    const text = this.takeDraft(explicit);
    if (!text) return false;
    if (isSpeakStop(text, watchword(), true)) {
      this.haltSpeak();
      return true;
    }
    this.resetSpeech();
    await this.hydrate();
    this.append("you", text);
    this.liveVoice = this.voiceEnabled();
    this.busy = true;
    this.paintHeader();
    if (this.wakeOn && micCaptureAllowed() && !this.holdTalk) this.startWake();
    let reply = "";
    try {
      if (!csrfToken()) await bootSession();
      this.history.push({ role: "user", content: text });
      const view = includeView() ? this.captureView?.() ?? undefined : undefined;
      const chatBody = (extra: Record<string, unknown> = {}) => JSON.stringify({
        redact: redaction.enabled,
        backend: this.backend,
        model: this.modelTag,
        messages: this.history.slice(-10),
        ...(view ? { view: { hud: view.hud, ...(view.screenshot ? { screenshot: view.screenshot } : {}) } } : {}),
        ...extra,
      });
      let r = await apiFetch("/api/ai/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: chatBody(),
      });
      if (!r.ok) {
        const raw = await r.text();
        this.history.pop();
        const fail = parseOllamaChat(raw).content || r.statusText;
        this.append("agent", `chat failed (${r.status}): ${fail}`);
        return true;
      }
      let { thinking, content } = await this.readChat(r);
      let polls = 0;
      while (needsAgentReply(thinking, content) && polls < AGENT_REPLY_POLLS) {
        polls += 1;
        r = await apiFetch("/api/ai/chat", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: chatBody({ poll: true }),
        });
        if (!r.ok) break;
        const next = await this.readChat(r);
        thinking += next.thinking;
        content += next.content;
      }
      reply = content;
      this.history.push({ role: "assistant", content: reply, thinking: thinking || undefined });
      const settingsPatch = extractSettings(reply);
      if (settingsPatch) {
        if (!this.controlOn) this.append("agent", "AI Control is off — settings were not applied");
        else await this.onApplySettings?.(settingsPatch);
      }
      const look = extractAgentLook(reply);
      if (look) {
        if (!this.controlOn) this.append("agent", "AI Control is off — shader / photos / SVG were not applied");
        else {
          try { await this.onApplyLook?.(look); }
          catch (e) { this.append("agent", String(e)); }
        }
      }
      const files = extractPluginFiles(reply);
      if (files) {
        const names = Object.keys(files).join(", ");
        if (!this.controlOn) {
          const d = await apiFetch("/api/ai/plugin", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ files }),
          }).then((x) => x.json()) as { ok?: boolean; error?: string };
          this.append("agent", d.ok
            ? `plugin draft is valid (${names}) — enable AI Control to install it`
            : `plugin invalid: ${d.error}`);
        } else {
          const d = await apiFetch("/api/ai/plugin/local", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ files, activate: true }),
          }).then((x) => x.json()) as {
            ok?: boolean; error?: string; message?: string; id?: string; activated?: boolean; consentRequired?: boolean;
          };
          if (d.activated) this.append("agent", `plugin ${d.id} built and activated (${names})`);
          else if (d.consentRequired) this.append("agent", `plugin ${d.id} installed (${names}) — source review required`);
          // #185: the install lint couldn't run; show the service's own wording, not "plugin invalid".
          else if (d.error === "pack_install_check_unavailable" && d.message) this.append("agent", d.message);
          else this.append("agent", d.ok ? `plugin ${d.id} built (${names})` : `plugin invalid: ${d.error}`);
        }
      }
    } catch (e) {
      this.append("agent", String(e));
    } finally {
      this.busy = false;
      this.paintHeader();
    }
    this.onChatEnd?.();
    if (reply && this.liveVoice && !this.heardFeed) {
      this.displayCaughtUp = true;
      const { chunks, already } = takeSpokenChunks(reply, "", true);
      this.spoken = already;
      if (chunks.length) {
        this.speakQ.push(...chunks);
        void this.pumpSpeak();
      }
    }
    if (reply && this.liveVoice) {
      try { await this.awaitSpeech(); }
      finally { this.speaking = false; }
    }
    this.paintHeader();
    if (this.wakeOn && micCaptureAllowed() && !this.holdTalk) this.startWake();
    return true;
  }

  private async readChat(r: Response): Promise<{ thinking: string; content: string }> {
    const reader = r.body?.getReader();
    if (!reader) {
      return parseOllamaChat(await r.text());
    }
    const dec = new TextDecoder();
    let buf = "";
    let thinking = "";
    let content = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        const bit = parseOllamaLine(line);
        if (!bit) continue;
        if (bit.error) return { thinking, content: bit.error };
        if (bit.thinking) {
          thinking += bit.thinking;
          this.onChat?.("think", bit.thinking, true);
        }
        if (bit.content) {
          content += bit.content;
          this.displayCaughtUp = false;
          this.onChat?.("agent", bit.content, true);
        }
      }
    }
    if (buf.trim()) {
      const bit = parseOllamaLine(buf);
      if (bit?.thinking) { thinking += bit.thinking; this.onChat?.("think", bit.thinking, true); }
      if (bit?.content) {
        content += bit.content;
        this.displayCaughtUp = false;
        this.onChat?.("agent", bit.content, true);
      }
      if (bit?.error) return { thinking, content: bit.error };
    }
    const tagged = splitThinkTags(thinking, content);
    return tagged;
  }

  /** Feed typewriter: speak each sentence as it is painted. */
  hearFeed(info: { role: string; shown: string; done: boolean }): void {
    if (!this.liveVoice || this.speakMuted || !soundAllowed() || info.role !== "agent") {
      if (info.role === "agent" && info.done) {
        this.displayCaughtUp = true;
        this.signalSpeech();
      }
      return;
    }
    this.heardFeed = true;
    if (info.done) this.displayCaughtUp = true;
    const { chunks, already } = takeSpokenChunks(info.shown, this.spoken, info.done);
    this.spoken = already;
    if (chunks.length) {
      this.speakQ.push(...chunks);
      void this.pumpSpeak();
    } else {
      this.signalSpeech();
    }
  }

  private voiceEnabled(): boolean {
    if (this.speakMuted || !soundAllowed()) return false;
    try { return localStorage.getItem(VOICE_KEY) !== "0"; }
    catch { return true; }
  }

  private resetSpeech(): void {
    this.speakAbort?.abort();
    this.speakAbort = new AbortController();
    this.speakQ = [];
    this.spoken = "";
    this.speakRunning = false;
    this.displayCaughtUp = true;
    this.heardFeed = false;
    this.liveVoice = false;
    this.speaking = false;
    this.speechWait?.();
    this.speechWait = null;
    if ("speechSynthesis" in window) speechSynthesis.cancel();
  }

  private speechIdle(): boolean {
    return this.displayCaughtUp && !this.speakQ.length && !this.speakRunning;
  }

  private signalSpeech(): void {
    if (!this.speechIdle()) return;
    this.speaking = false;
    const done = this.speechWait;
    this.speechWait = null;
    done?.();
  }

  private awaitSpeech(): Promise<void> {
    if (!this.voiceEnabled() || this.speechIdle()) return Promise.resolve();
    return new Promise((resolve) => {
      const prev = this.speechWait;
      this.speechWait = () => { prev?.(); resolve(); };
      window.setTimeout(() => resolve(), 120_000);
    });
  }

  private async pumpSpeak(): Promise<void> {
    if (this.speakRunning) return;
    this.speakRunning = true;
    this.speaking = true;
    this.paintHeader();
    try {
      while (this.speakQ.length && !this.speakMuted) {
        const bit = this.speakQ.shift();
        if (bit) await this.speak(bit, true);
      }
    } finally {
      this.speakRunning = false;
      this.signalSpeech();
    }
  }

  private async speak(reply: string, chain = false): Promise<void> {
    if (this.speakMuted || !soundAllowed() || localStorage.getItem(VOICE_KEY) === "0") return;
    const text = spokenText(reply);
    if (!text) return;
    if (STREAM_TTS.has(this.ttsEngine) || !(await this.speakBrowser(text, chain))) {
      await this.speakHost(text);
    }
  }

  private async speakBrowser(text: string, chain = false): Promise<boolean> {
    if (!("speechSynthesis" in window)) return false;
    const voices = await waitVoices(this.voicesTried ? 0 : 400);
    this.voicesTried = true;
    if (!voices.length) return false;
    unlockSpeech();
    return new Promise((resolve) => {
      const u = new SpeechSynthesisUtterance(text.slice(0, TTS_CAP));
      u.volume = 1;
      u.rate = 1;
      u.pitch = 1;
      const voice = pickVoice(voices);
      if (voice) u.voice = voice;
      const t = window.setTimeout(() => resolve(true), 60_000);
      const done = (ok: boolean) => { window.clearTimeout(t); resolve(ok); };
      u.onend = () => done(true);
      u.onerror = () => done(false);
      if (!chain) speechSynthesis.cancel();
      speechSynthesis.speak(u);
    });
  }

  private async speakHost(text: string): Promise<void> {
    const signal = this.speakAbort?.signal;
    if (signal?.aborted) return;
    try {
      const r = await apiFetch("/api/ai/speak", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          text: text.slice(0, TTS_CAP),
          voice: localStorage.getItem(TTS_VOICE_KEY) || "",
        }),
        signal,
      });
      const ct = r.headers.get("content-type") || "";
      if (r.ok && ct.includes("audio/pcm")) {
        await playPcmStream(r, signal);
        return;
      }
      if (r.ok) return;
      if (this.noVoiceHint) return;
      this.noVoiceHint = true;
      const d = await r.json().catch(() => ({})) as { error?: string };
      this.append("agent", d.error || "no TTS engine — set ELEVENLABS_API_KEY, a loopback Kokoro URL, or install espeak-ng.");
    } catch (e) {
      if (signal?.aborted) return;
      if (this.noVoiceHint) return;
      this.noVoiceHint = true;
      this.append("agent", e instanceof Error ? e.message : "no TTS engine — set ELEVENLABS_API_KEY, a loopback Kokoro URL, or install espeak-ng.");
    }
  }
}

function watchword(): string {
  return (localStorage.getItem(WATCH_KEY) || DEFAULT_WATCH).trim() || DEFAULT_WATCH;
}

/** Remainder after the watchword, or null if it was not said. Empty string means the word alone. */
export function afterWatchword(text: string, word: string): string | null {
  const said = normSpeech(text);
  const w = normSpeech(word);
  if (!said || !w) return null;
  for (const p of watchPhrases(w)) {
    const i = said.indexOf(p);
    if (i < 0) continue;
    const before = i === 0 || said[i - 1] === " ";
    const after = i + p.length === said.length || said[i + p.length] === " ";
    if (!before || !after) continue;
    return said.slice(i + p.length).trim();
  }
  return null;
}

/** Watchword plus stop (or a bare “stop” once already listening / speaking). */
export function isSpeakStop(text: string, word: string, attentive = false): boolean {
  const rest = afterWatchword(text, word);
  const said = rest !== null ? afterSendCue(rest).body : attentive ? afterSendCue(text).body : "";
  if (rest === null && !attentive) return false;
  return /^(please\s+)?stop(\s+(talking|speaking|that))?$/.test(said);
}

/** Trailing “send” (or “please send”) is the submit cue after the watchword. */
export function afterSendCue(text: string): { body: string; send: boolean } {
  const said = normSpeech(text);
  if (!said) return { body: "", send: false };
  const m = said.match(/^(.*?)(?:^|\s)(?:please\s+)?send$/);
  if (!m) return { body: said, send: false };
  return { body: (m[1] || "").trim(), send: true };
}

/** STT often splits or voiceless-shifts invented words (“zoto” → “so to” / “soto”). */
function watchPhrases(word: string): string[] {
  const forms = new Set<string>([word]);
  if (word.startsWith("z")) forms.add(`s${word.slice(1)}`);
  else if (word.startsWith("s")) forms.add(`z${word.slice(1)}`);
  if (word.length >= 4) forms.add(`${word.slice(0, 2)} ${word.slice(2)}`);
  if (word === "zoto") {
    for (const a of ["so to", "zo to", "so toe", "zo toe"]) forms.add(a);
  }
  const phrases: string[] = [];
  for (const f of forms) {
    phrases.push(f, `hey ${f}`, `ok ${f}`, `okay ${f}`, `okey ${f}`, `hi ${f}`);
    if (!f.includes(" ")) phrases.push(`hey${f}`, `ok${f}`, `okay${f}`);
  }
  return [...new Set(phrases)].sort((a, b) => b.length - a.length);
}

export function spokenText(reply: string): string {
  return reply
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[*_`#]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Drop an unclosed fence so TTS does not read yaml / shader source mid-stream. */
export function speakablePrefix(text: string): string {
  const parts = text.split("```");
  if (parts.length % 2 === 0) return parts[0] ?? "";
  return text;
}

function sharedPrefixLength(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a[i] === b[i]) i += 1;
  return i;
}

/** Sentences (or a flushed tail) that have appeared on the ticker but not yet been spoken. */
export function takeSpokenChunks(displayed: string, already: string, flush = false): { chunks: string[]; already: string } {
  const voice = spokenText(speakablePrefix(displayed));
  let pos = already && voice.startsWith(already) ? already.length : sharedPrefixLength(voice, already);
  const chunks: string[] = [];
  const mark = /[.!?…]["')\]]*(\s+|$)/g;
  while (pos < voice.length) {
    mark.lastIndex = pos;
    const m = mark.exec(voice);
    if (!m) break;
    const end = m.index + m[0].length;
    const bit = voice.slice(pos, end).trim();
    pos = end;
    if (bit) chunks.push(bit);
  }
  if (flush) {
    const bit = voice.slice(pos).trim();
    if (bit) chunks.push(bit);
    pos = voice.length;
  }
  return { chunks, already: voice.slice(0, pos) };
}

function normSpeech(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

function lastTranscript(e: SpeechResultEvent, finalsOnly = false): string {
  let out = "";
  for (let i = e.resultIndex; i < e.results.length; i++) {
    const r = e.results[i];
    if (finalsOnly && !r.isFinal) continue;
    out += r[0]?.transcript ?? "";
  }
  return out.trim();
}

/** Whole recognition session, including interims. Prefer an alternative that contains the watchword. */
function sessionTranscript(e: SpeechResultEvent, word: string): string {
  let out = "";
  for (let i = 0; i < e.results.length; i++) {
    const r = e.results[i];
    let bit = r[0]?.transcript ?? "";
    const n = r.length ?? 1;
    for (let j = 0; j < n; j++) {
      const t = r[j]?.transcript ?? "";
      if (afterWatchword(t, word) !== null) {
        bit = t;
        break;
      }
    }
    out += bit;
  }
  return out.trim();
}

function waitVoices(ms: number): Promise<SpeechSynthesisVoice[]> {
  if (!("speechSynthesis" in window)) return Promise.resolve([]);
  const have = speechSynthesis.getVoices();
  if (have.length || ms <= 0) return Promise.resolve(have);
  return new Promise((resolve) => {
    let t = 0;
    const done = () => {
      speechSynthesis.removeEventListener("voiceschanged", done);
      window.clearTimeout(t);
      resolve(speechSynthesis.getVoices());
    };
    t = window.setTimeout(done, ms);
    speechSynthesis.addEventListener("voiceschanged", done);
  });
}

function pickVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  return voices.find((v) => /^en(-|$)/i.test(v.lang) && v.localService)
    ?? voices.find((v) => /^en(-|$)/i.test(v.lang))
    ?? voices[0]
    ?? null;
}

function unlockSpeech(): void {
  if (!("speechSynthesis" in window)) return;
  try {
    const u = new SpeechSynthesisUtterance(" ");
    u.volume = 0;
    speechSynthesis.speak(u);
    speechSynthesis.cancel();
  } catch { /* some engines throw if no voices yet */ }
}

export function parseOllamaLine(line: string): { thinking?: string; content?: string; error?: string } | null {
  const t = line.trim();
  if (!t) return null;
  try {
    const j = JSON.parse(t) as { message?: { content?: string; thinking?: string }; error?: string };
    if (j.error) return { error: j.error };
    const out: { thinking?: string; content?: string } = {};
    if (j.message?.thinking) out.thinking = j.message.thinking;
    if (j.message?.content) out.content = j.message.content;
    return out.thinking || out.content ? out : null;
  } catch {
    return { content: t };
  }
}

export function splitThinkTags(thinking: string, content: string): { thinking: string; content: string } {
  const tagged = [...content.matchAll(/<think>([\s\S]*?)<\/think>/gi)].map((m) => m[1]!.trim());
  if (!tagged.length) return { thinking, content };
  return {
    thinking: [thinking, ...tagged].filter(Boolean).join("\n").trim(),
    content: content.replace(/<think>[\s\S]*?<\/think>/gi, "").trim(),
  };
}

export function parseOllamaChat(raw: string): { thinking: string; content: string } {
  const trimmed = raw.trim();
  if (trimmed.startsWith("{") && !trimmed.includes("\n")) {
    const bit = parseOllamaLine(trimmed);
    if (bit?.error) return { thinking: "", content: bit.error };
    if (bit) return splitThinkTags(bit.thinking || "", bit.content || "");
  }
  let thinking = "";
  let content = "";
  for (const line of raw.split("\n")) {
    const bit = parseOllamaLine(line);
    if (!bit) continue;
    if (bit.error) return { thinking, content: bit.error };
    if (bit.thinking) thinking += bit.thinking;
    if (bit.content) content += bit.content;
  }
  if (!content && !thinking) content = raw.slice(0, 2000);
  return splitThinkTags(thinking, content);
}

export function extractYaml(text: string): string | null {
  return extractPluginFiles(text)?.["plugin.yml"] ?? null;
}

const SKIP_FENCE = new Set(["settings", "memory", "shader", "photo", "svg", "deco"]);

function fencePath(info: string): string | null {
  const bits = info.trim().split(/\s+/).filter(Boolean);
  for (const raw of bits) {
    const t = raw.replace(/^["']|["']$/g, "").replace(/^\.\//, "");
    if (SKIP_FENCE.has(t.toLowerCase())) return null;
    if (t.includes("/") || /\.(ya?ml|tsx?|jsx?|mjs|py|glsl|json|md|css|html)$/i.test(t)) return t;
  }
  const lang = (bits[0] || "").toLowerCase();
  if (lang === "ts" || lang === "tsx" || lang === "typescript" || lang === "javascript" || lang === "js") {
    return "frontend/index.ts";
  }
  if (lang === "py" || lang === "python") return "backend/service.py";
  return null;
}

function looksPluginYml(body: string): boolean {
  return /^\s*id:\s/m.test(body);
}

function looksVizYml(body: string): boolean {
  return /^\s*(engine|base|look|style|layout):/m.test(body);
}

/** Full plugin tree from path-tagged fences (and a ```files JSON object). */
export function extractPluginFiles(text: string): Record<string, string> | null {
  const files: Record<string, string> = {};
  const unlabeledYaml: string[] = [];
  const re = /```([^\n`]*)\n([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const info = (m[1] || "").trim();
    const body = (m[2] || "").replace(/\s+$/, "");
    if (!body) continue;
    const lang = info.split(/\s+/)[0]?.toLowerCase() || "";
    if (lang === "files") {
      try {
        const v = JSON.parse(body) as unknown;
        if (v && typeof v === "object" && !Array.isArray(v)) {
          for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
            if (typeof val === "string" && k) files[k.replace(/^\.\//, "")] = val;
          }
        }
      } catch { /* ignore */ }
      continue;
    }
    if (SKIP_FENCE.has(lang) || lang === "glsl" && !info.includes("/")) continue;
    const path = fencePath(info);
    if (path) {
      files[path] = body;
      continue;
    }
    if (lang === "yaml" || lang === "yml" || (!lang && looksPluginYml(body))) unlabeledYaml.push(body);
  }
  for (const body of unlabeledYaml) {
    if (!files["plugin.yml"] && looksPluginYml(body)) files["plugin.yml"] = body;
    else if (!files["visualisation.yml"] && looksVizYml(body)) files["visualisation.yml"] = body;
  }
  return files["plugin.yml"] ? files : null;
}

export function extractMemory(text: string): string | null {
  const m = text.match(/```memory\n([\s\S]+?)```/i);
  if (!m) return null;
  const inner = m[1]!.trim();
  if (inner.startsWith("{")) {
    try {
      const v = JSON.parse(inner) as { text?: unknown };
      if (typeof v.text === "string" && v.text.trim()) return v.text.trim();
    } catch { /* fall through */ }
  }
  return inner || null;
}

export function displayText(reply: string): string {
  const stripped = reply
    .replace(/```memory\n[\s\S]*?```/gi, "")
    .replace(/```(?:shader|glsl|photo|svg|deco)\n[\s\S]*?```/gi, "")
    .trim();
  return stripped || reply;
}

export function extractSettings(text: string): Record<string, unknown> | null {
  const m = text.match(/```settings\n([\s\S]+?)```/i);
  if (!m) return null;
  try {
    const v = JSON.parse(m[1]!) as unknown;
    return v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

export interface AgentLookInput {
  shader?: string;
  photos?: { url: string; at?: unknown }[];
  svg?: string;
  clear?: boolean;
}

function fence(text: string, name: string): string | null {
  const m = text.match(new RegExp("```" + name + "\\n([\\s\\S]+?)```", "i"));
  return m ? m[1]!.trim() : null;
}

export function extractShader(text: string): string | null {
  return fence(text, "shader") || fence(text, "glsl");
}

export function extractSvg(text: string): string | null {
  const inner = fence(text, "svg");
  if (!inner) return null;
  return inner.startsWith("<svg") ? inner : null;
}

export function extractPhotos(text: string): { url: string; at?: unknown }[] {
  const inner = fence(text, "photo");
  if (!inner) return [];
  const out: { url: string; at?: unknown }[] = [];
  if (inner.startsWith("{") || inner.startsWith("[")) {
    try {
      const v = JSON.parse(inner) as unknown;
      const rows = Array.isArray(v) ? v : [v];
      for (const row of rows) {
        if (!row || typeof row !== "object") continue;
        const url = String((row as { url?: unknown }).url || "").trim();
        if (url.startsWith("https://")) out.push({ url, at: (row as { at?: unknown }).at });
      }
    } catch { /* fall through */ }
  }
  if (!out.length) {
    for (const line of inner.split("\n")) {
      const url = line.trim();
      if (url.startsWith("https://")) out.push({ url });
    }
  }
  return out.filter((p) => !isNasaStillUrl(p.url));
}

export function extractAgentLook(text: string): AgentLookInput | null {
  const deco = fence(text, "deco");
  let clear = false;
  if (deco) {
    try {
      const v = JSON.parse(deco) as { clear?: unknown };
      if (v && v.clear) clear = true;
    } catch { /* ignore */ }
  }
  const shader = extractShader(text) ?? undefined;
  const photos = extractPhotos(text);
  const svg = extractSvg(text) ?? undefined;
  if (!shader && !photos.length && !svg && !clear) return null;
  const look: AgentLookInput = {};
  if (shader) look.shader = shader;
  if (photos.length) look.photos = photos;
  if (svg) look.svg = svg;
  if (clear) look.clear = true;
  return look;
}

interface SpeechRec {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: SpeechResultEvent) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
}

interface SpeechResultEvent {
  resultIndex: number;
  results: ArrayLike<{ isFinal: boolean } & ArrayLike<{ transcript: string }>>;
}
