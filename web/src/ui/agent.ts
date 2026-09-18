import { Toggle, TextField } from "./ui";
import { OddsStrip, TemperRail, clampTemper, parseWeather, setCurrentWeather, type Weather } from "./temper";
import { redaction } from "../core/redact";
import { setTsPluginsAllowed, tsPluginsAllowed } from "../plugins/host";
import { apiFetch, bootSession, csrfToken } from "../core/http";
import { playPcmStream } from "../audio/tts";
import { WakeStream } from "../audio/wake-stream";
import { includeView, VIEW_KEY, type ViewCapture } from "./capture";
import { askUserMedia, clearMediaDismiss } from "./media-ask";
import { micCaptureAllowed } from "../audio/want";
import { fillMarkdown } from "./markdown";

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

/** Header AI cycling. Unset means on; only an explicit `"0"` is off. */
export function aiCyclePrefOn(store: Pick<Storage, "getItem"> | null = typeof localStorage === "undefined" ? null : localStorage): boolean {
  try {
    return store?.getItem(CYCLE_KEY) !== "0";
  } catch {
    return true;
  }
}
const MODEL_KEY = "zoto-viz.aiModel";
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
const CYCLE_TIP = "AI cycling on — Dynamic sky, cadence themes, views and motion (profile named after the Ollama model)";

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
  private readonly log: HTMLDivElement;
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
  private silence = 0;
  private restart = 0;
  private controlToggle: Toggle;
  private temperRail!: TemperRail;
  private oddsStrip!: OddsStrip;
  private temperTimer = 0;
  private modelField!: TextField;
  private history: { role: "user" | "assistant"; content: string; thinking?: string }[] = [];
  private hydrateP: Promise<void> | null = null;
  private logEpoch = 0;
  private stickLog = true;
  private pinningLog = false;
  private thinkHold: HTMLParagraphElement | null = null;
  private noVoiceHint = false;
  private voicesTried = false;
  private ttsEngine = "";
  private lastOllama: { ok: boolean; models: string[] } = { ok: false, models: [] };
  private speakAbort: AbortController | null = null;
  onControl?: (on: boolean) => void;
  onCycle?: (on: boolean) => void;
  onOpen?: () => void;
  onApplySettings?: (patch: Record<string, unknown>) => void | Promise<void>;
  onApplyLook?: (look: AgentLookInput) => Promise<void>;
  onChat?: (role: "you" | "think" | "agent", text: string, stream?: boolean) => void;
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
    document.addEventListener("pointerdown", () => {
      if (!micCaptureAllowed()) return;
      if (this.wakeOn && !this.micBlocked && !this.rec && !this.busy && !this.speaking && !this.holdTalk) this.startWake();
    });

    this.statusEl = document.createElement("div");
    this.statusEl.className = "sec-hint";
    this.statusEl.textContent = "Local Ollama · gemma4";
    void this.refreshStatus();

    const control = new Toggle({
      label: "AI Control",
      title: "when on, the agent may change settings and install drafted plugins. The header AI toggle also turns this on with a profile named after the model.",
      checked: false,
      onChange: (on) => { void this.pushControl(on); },
    });
    this.controlToggle = control;
    document.body.classList.toggle("ai-control", control.checked);

    const ts = new Toggle({
      label: "allow TypeScript plugins",
      title: "compile and run sandboxed entry.ts after you confirm you wrote or reviewed the source",
      checked: tsPluginsAllowed(),
      onChange: (on) => setTsPluginsAllowed(on),
    });

    const listen = new Toggle({
      label: "listen for watchword",
      title: "hold a live mic stream; after the watchword, talk, then say send",
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
      },
    });

    const voice = new Toggle({
      label: "speak replies",
      title: "read agent replies through the speakers (ElevenLabs / Kokoro / Piper stream, else espeak)",
      checked: localStorage.getItem(VOICE_KEY) !== "0",
      onChange: (on) => localStorage.setItem(VOICE_KEY, on ? "1" : "0"),
    });

    const watch = new TextField({
      caption: "watchword",
      title: "always-on listening waits for this word (also ‘hey …’ / ‘okay …’); say send after the question",
      value: localStorage.getItem(WATCH_KEY) || DEFAULT_WATCH,
      placeholder: DEFAULT_WATCH,
      onInput: (v) => localStorage.setItem(WATCH_KEY, v.trim() || DEFAULT_WATCH),
    });

    const view = new Toggle({
      label: "include screen",
      title: "attach a JPEG of the live canvas plus a compact HUD of mode, theme, and stats",
      checked: includeView(),
      onChange: (on) => localStorage.setItem(VIEW_KEY, on ? "1" : "0"),
    });
    const mosaicLayout = new Toggle({
      label: "AI mosaic layout",
      title: "On: the model may resize, rearrange, close, or change the mosaic grid. Off: it may only change which views sit in the existing tiles.",
      checked: aiMosaicLayoutOn(),
      onChange: (on) => localStorage.setItem(MOSAIC_LAYOUT_KEY, on ? "1" : "0"),
    });

    this.modelField = new TextField({
      caption: "model",
      title: "Ollama model tag (loopback only)",
      value: localStorage.getItem(MODEL_KEY) || "gemma4",
      placeholder: "gemma4",
      onInput: (v) => localStorage.setItem(MODEL_KEY, v.trim() || "gemma4"),
    });
    const ttsVoice = new TextField({
      caption: "TTS voice",
      title: "ElevenLabs voice id, or Kokoro name (af_heart). Empty uses the monitor default.",
      value: localStorage.getItem(TTS_VOICE_KEY) || "",
      placeholder: "af_heart",
      onInput: (v) => localStorage.setItem(TTS_VOICE_KEY, v.trim()),
    });

    this.temperRail = new TemperRail({
      onChange: (n) => this.pushTemper({ temper: n }),
    });
    this.oddsStrip = new OddsStrip({
      onChange: (w) => {
        setCurrentWeather(w);
        this.pushTemper({ weather: w });
      },
    });
    setCurrentWeather(this.oddsStrip.value);

    this.log = document.createElement("div");
    this.log.className = "agent-log";
    this.log.addEventListener("scroll", () => {
      if (this.pinningLog) return;
      this.stickLog = this.log.scrollHeight - this.log.scrollTop - this.log.clientHeight < 48;
    });
    this.log.addEventListener("wheel", (e) => {
      if (this.pinningLog) return;
      if (e.deltaY < 0) this.stickLog = false;
    }, { passive: true });
    this.input = document.createElement("textarea");
    this.input.placeholder = "Ask about the LAN, or say the watchword… then send";
    const send = document.createElement("button");
    send.type = "button";
    send.textContent = "send";
    send.addEventListener("click", () => void this.send());
    const talk = document.createElement("button");
    talk.type = "button";
    talk.textContent = "talk";
    talk.title = "hold to speak without the watchword";
    talk.addEventListener("pointerdown", (e) => { e.preventDefault(); this.startHold(); });
    talk.addEventListener("pointerup", () => this.stopHold());
    talk.addEventListener("pointerleave", () => this.stopHold());
    const clear = document.createElement("button");
    clear.type = "button";
    clear.textContent = "clear";
    clear.title = "clear the on-screen log and stored transcript (memories stay)";
    clear.addEventListener("click", () => void this.clearHistory());
    const row = document.createElement("div");
    row.className = "agent-row";
    row.append(this.input, send, talk, clear);

    this.el.append(
      this.statusEl,
      this.temperRail.el,
      this.oddsStrip.el,
      this.modelField.el, ttsVoice.el, control.el, listen.el, watch.el, voice.el, ts.el, view.el, mosaicLayout.el, this.log, row,
    );
    this.paintHeader();
    void this.hydrate();
    if ("speechSynthesis" in window) {
      speechSynthesis.getVoices();
      speechSynthesis.addEventListener("voiceschanged", () => speechSynthesis.getVoices());
    }
  }

  get controlOn(): boolean { return this.controlToggle.checked; }
  get cycleOn(): boolean { return this.headerToggle.checked; }
  get modelTag(): string {
    return this.modelField.value.trim() || localStorage.getItem(MODEL_KEY) || "gemma4";
  }

  async probeOllama(): Promise<{ ok: boolean; model: string; models: string[]; online: boolean }> {
    await this.refreshStatus();
    const model = this.modelTag;
    const online = this.lastOllama.ok && (
      this.lastOllama.models.length ? this.lastOllama.models.includes(model) : true
    );
    return { ok: this.lastOllama.ok, model, models: this.lastOllama.models, online };
  }

  /** Set the header switch without firing onCycle. */
  setCycleChecked(on: boolean): void {
    this.headerToggle.checked = on;
    this.paintHeader();
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
      };
      this.ttsEngine = String(d.tts || "");
      this.lastOllama = { ok: !!d.ok, models: Array.isArray(d.models) ? d.models.filter((m) => typeof m === "string") : [] };
      if (typeof d.temper === "number" || d.weather) this.syncTemper({ temper: d.temper, weather: d.weather });
      if (d.ok && d.model && d.models?.length && !d.models.includes(this.modelField.value.trim() || "gemma4")) {
        this.modelField.value = d.model;
        localStorage.setItem(MODEL_KEY, d.model);
      }
      const listen = this.wakeOn ? `Listening for “${watchword()}”.` : "Watchword listening is off.";
      const tts = this.ttsEngine ? ` TTS ${this.ttsEngine}.` : "";
      this.statusEl.textContent = d.ok
        ? `Ollama ${d.host || "127.0.0.1:11434"} · ${d.hasGemma ? (d.model || "gemma4") : `pull gemma4`}.${tts} ${listen}`
        : `Ollama offline (${d.error || "unreachable"}). Loopback only (${d.host || "127.0.0.1:11434"}).`;
    } catch {
      this.lastOllama = { ok: false, models: [] };
      this.statusEl.textContent = "Ollama status unknown — is the monitor up?";
    }
  }

  transcript(): { role: "user" | "assistant"; content: string; thinking?: string }[] {
    return this.history.slice();
  }

  private append(role: string, text: string): void {
    const p = document.createElement("p");
    if (role === "think" || role === "agent") {
      p.className = role === "think" ? "think md" : "md";
      const k = document.createElement("span");
      k.className = "k";
      k.textContent = role;
      const body = document.createElement("div");
      body.className = "md-body";
      fillMarkdown(body, text);
      p.append(k, body);
    } else {
      p.textContent = `${role}: ${text}`;
    }
    this.log.appendChild(p);
    if (role === "you") this.stickLog = true;
    if (role === "think") this.markLogThinking(false);
    this.pinLog();
  }

  private pinLog(force = false): void {
    if (!force && !this.stickLog) return;
    const go = () => {
      this.pinningLog = true;
      this.log.scrollTop = this.log.scrollHeight;
      this.pinningLog = false;
    };
    go();
    requestAnimationFrame(() => { if (force || this.stickLog) go(); });
  }

  private markLogThinking(on: boolean): void {
    if (on) {
      if (this.thinkHold) return;
      const p = document.createElement("p");
      p.className = "think pending";
      p.setAttribute("aria-live", "polite");
      p.textContent = "thinking…";
      this.thinkHold = p;
      this.log.appendChild(p);
      this.pinLog();
      return;
    }
    this.thinkHold?.remove();
    this.thinkHold = null;
  }

  private paintLog(): void {
    this.thinkHold = null;
    this.log.replaceChildren();
    for (const m of this.history) {
      if (m.role === "user") this.append("you", m.content);
      else {
        if (m.thinking) this.append("think", m.thinking);
        if (m.content) this.append("agent", displayText(m.content));
      }
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
        const d = await r.json() as { messages?: { role?: string; content?: string; thinking?: string }[] };
        if (!Array.isArray(d.messages)) return;
        if (epoch !== this.logEpoch) return;
        this.history = d.messages
          .filter((m) => m.role === "user" || m.role === "assistant")
          .map((m) => ({
            role: m.role as "user" | "assistant",
            content: String(m.content || ""),
            thinking: m.thinking ? String(m.thinking) : undefined,
          }));
        this.paintLog();
        this.onTranscript?.();
      } catch { /* monitor may still be coming up */ }
    })();
    this.hydrateP = run;
    return run;
  }

  private async clearHistory(): Promise<void> {
    this.logEpoch += 1;
    this.history = [];
    this.thinkHold = null;
    this.log.replaceChildren();
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
    this.markLogThinking(phase === "think");
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
    void this.armListen(restart);
  }

  /** Hold one MediaStream for the whole listen session; SpeechRecognition may restart on it. */
  private async armListen(restart = false): Promise<void> {
    if (!micCaptureAllowed() || !this.wakeOn || this.busy || this.speaking || this.holdTalk) return;
    if (this.rec && !restart) return;
    const SR = this.speechEngine();
    if (!SR) {
      this.wakeStream.disable();
      if (restart) this.append("agent", "this browser has no speech recognition — Chromium on localhost is required");
      return;
    }
    const stream = await askUserMedia({ audio: true, video: false }, "watchword listening");
    if (!stream || !micCaptureAllowed() || !this.wakeOn) {
      if (stream) for (const t of stream.getTracks()) t.stop();
      this.wakeStream.disable();
      if (!stream && this.wakeOn && micCaptureAllowed()) this.micBlocked = true;
      return;
    }
    if (this.busy || this.speaking || this.holdTalk) {
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
    if (this.busy || this.speaking || this.holdTalk) return;
    if (this.rec && !restart) return;
    if (!open) {
      this.micBlocked = true;
      this.headerEl.title = "allow the microphone on the in-page prompt (this window has no browser listening dialog)";
      return;
    }
    this.micBlocked = false;
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
      if (this.wakeOn && micCaptureAllowed() && !this.busy && !this.speaking && !this.holdTalk && !this.micBlocked) {
        this.restart = window.setTimeout(() => this.startWake(), 250);
      }
    };
    try {
      rec.start();
      this.rec = rec;
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
    if (this.busy || this.speaking || this.holdTalk) return;
    const word = watchword();
    const said = sessionTranscript(e, word);
    if (!said) return;
    const rest = afterWatchword(said, word);
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
    this.speakAbort?.abort();
    this.speakAbort = null;
    if ("speechSynthesis" in window) speechSynthesis.cancel();
    void apiFetch("/api/ai/speak", { method: "DELETE" });
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
    await this.send(text);
  }

  /** False if a turn is already in flight — the ticker keeps the draft. */
  offerSend(text: string): boolean {
    if (this.busy) return false;
    void this.send(text);
    return true;
  }

  private async send(explicit?: string): Promise<boolean> {
    if (this.busy) return false;
    const text = this.takeDraft(explicit);
    if (!text) return false;
    await this.hydrate();
    this.append("you", text);
    this.onChat?.("you", text);
    this.busy = true;
    this.stopRec();
    this.paintHeader();
    let reply = "";
    try {
      if (!csrfToken()) await bootSession();
      this.history.push({ role: "user", content: text });
      const view = includeView() ? this.captureView?.() ?? undefined : undefined;
      const chatBody = (extra: Record<string, unknown> = {}) => JSON.stringify({
        redact: redaction.enabled,
        model: localStorage.getItem(MODEL_KEY) || this.modelField.value || "gemma4",
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
        this.onChat?.("agent", `chat failed (${r.status}): ${fail}`);
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
      if (thinking) this.append("think", thinking);
      this.append("agent", displayText(reply));
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
      const yaml = extractYaml(reply);
      if (yaml) {
        if (!this.controlOn) {
          const d = await apiFetch("/api/ai/plugin", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ files: { "plugin.yml": yaml } }),
          }).then((x) => x.json()) as { ok?: boolean; error?: string };
          this.append("agent", d.ok ? "plugin draft is valid (enable AI Control to install it locally)" : `plugin invalid: ${d.error}`);
        } else {
          const d = await apiFetch("/api/ai/plugin/local", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ files: { "plugin.yml": yaml }, activate: true }),
          }).then((x) => x.json()) as {
            ok?: boolean; error?: string; id?: string; activated?: boolean; consentRequired?: boolean;
          };
          if (d.activated) this.append("agent", `plugin ${d.id} installed and activated`);
          else if (d.consentRequired) this.append("agent", `plugin ${d.id} installed — source review required`);
          else this.append("agent", d.ok ? `plugin ${d.id} installed` : `plugin invalid: ${d.error}`);
        }
      }
    } catch (e) {
      this.append("agent", String(e));
    } finally {
      this.busy = false;
      this.paintHeader();
    }
    if (reply) {
      this.speaking = true;
      this.paintHeader();
      try { await this.speak(reply); }
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
          this.onChat?.("agent", bit.content, true);
        }
      }
    }
    if (buf.trim()) {
      const bit = parseOllamaLine(buf);
      if (bit?.thinking) { thinking += bit.thinking; this.onChat?.("think", bit.thinking, true); }
      if (bit?.content) { content += bit.content; this.onChat?.("agent", bit.content, true); }
      if (bit?.error) return { thinking, content: bit.error };
    }
    const tagged = splitThinkTags(thinking, content);
    return tagged;
  }

  private async speak(reply: string): Promise<void> {
    if (localStorage.getItem(VOICE_KEY) === "0") return;
    const text = spokenText(reply);
    if (!text) return;
    if (STREAM_TTS.has(this.ttsEngine) || !(await this.speakBrowser(text))) {
      await this.speakHost(text);
    }
  }

  private async speakBrowser(text: string): Promise<boolean> {
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
      speechSynthesis.cancel();
      speechSynthesis.speak(u);
    });
  }

  private async speakHost(text: string): Promise<void> {
    this.speakAbort?.abort();
    this.speakAbort = new AbortController();
    const signal = this.speakAbort.signal;
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
      if (signal.aborted) return;
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
  const tagged = text.match(/```(?:ya?ml)\n([\s\S]+?)```/i);
  if (tagged) return tagged[1]!.trim();
  const bare = text.match(/```\n([\s\S]+?)```/);
  if (bare && /^\s*id:\s/m.test(bare[1]!)) return bare[1]!.trim();
  return null;
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
  return out;
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
