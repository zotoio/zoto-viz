import { Toggle, TextField } from "./ui";
import { redaction } from "../core/redact";
import { setTsPluginsAllowed, tsPluginsAllowed } from "../plugins/host";
import { apiFetch, bootSession, csrfToken } from "../core/http";
import { playPcmStream } from "../audio/tts";

const CONTROL_KEY = "zoto-viz.aiControl";
const MODEL_KEY = "zoto-viz.aiModel";
const VOICE_KEY = "zoto-viz.voice";
const TTS_VOICE_KEY = "zoto-viz.ttsVoice";
const LISTEN_KEY = "zoto-viz.wakeListen";
const WATCH_KEY = "zoto-viz.watchword";
const DEFAULT_WATCH = "zoto";
const SILENCE_MS = 1400;
const TTS_CAP = 2500;
const STREAM_TTS = new Set(["elevenlabs", "openai", "piper"]);

export class AgentPanel {
  readonly el: HTMLDivElement;
  readonly headerBtn: HTMLButtonElement;
  private readonly log: HTMLDivElement;
  private readonly input: HTMLTextAreaElement;
  private readonly statusEl: HTMLDivElement;
  private rec: SpeechRec | null = null;
  private wakeOn = localStorage.getItem(LISTEN_KEY) !== "0";
  private holdTalk = false;
  private busy = false;
  private command: string | null = null;
  private silence = 0;
  private restart = 0;
  private controlToggle: Toggle;
  private modelField!: TextField;
  private history: { role: "user" | "assistant"; content: string }[] = [];
  private noVoiceHint = false;
  private voicesTried = false;
  private ttsEngine = "";
  private speakAbort: AbortController | null = null;
  onControl?: (on: boolean) => void;
  onOpen?: () => void;
  onApplySettings?: (patch: Record<string, unknown>) => void;
  captureFrame?: () => string | null;

  constructor() {
    this.el = document.createElement("div");
    this.el.className = "agent-panel";
    this.headerBtn = document.createElement("button");
    this.headerBtn.type = "button";
    this.headerBtn.className = "toggle";
    this.headerBtn.textContent = "AI";
    this.headerBtn.title = "open the local agent · click to start watchword listening";
    this.headerBtn.addEventListener("click", () => {
      this.onOpen?.();
      void this.refreshStatus();
      if (this.wakeOn) this.startWake();
    });

    this.statusEl = document.createElement("div");
    this.statusEl.className = "sec-hint";
    this.statusEl.textContent = "Local Ollama · gemma4";
    void this.refreshStatus();

    const control = new Toggle({
      label: "AI Control",
      title: "when on, the agent may change settings and install drafted plugins (stored on the monitor, not only in this browser)",
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
      title: "keep the mic on and send speech to the local model after you say the watchword",
      checked: this.wakeOn,
      onChange: (on) => {
        this.wakeOn = on;
        localStorage.setItem(LISTEN_KEY, on ? "1" : "0");
        if (on) this.startWake();
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
      title: "always-on listening waits for this word (also ‘hey …’ / ‘okay …’) before sending to the model",
      value: localStorage.getItem(WATCH_KEY) || DEFAULT_WATCH,
      placeholder: DEFAULT_WATCH,
      onInput: (v) => localStorage.setItem(WATCH_KEY, v.trim() || DEFAULT_WATCH),
    });

    const view = new Toggle({
      label: "include view",
      title: "attach a JPEG of the graph for Gemma 4 vision insights (not the webcam)",
      checked: localStorage.getItem("zoto-viz.aiView") === "1",
      onChange: (on) => localStorage.setItem("zoto-viz.aiView", on ? "1" : "0"),
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

    this.log = document.createElement("div");
    this.log.className = "agent-log";
    this.input = document.createElement("textarea");
    this.input.placeholder = "Ask about the LAN, or say the watchword…";
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
    const row = document.createElement("div");
    row.className = "agent-row";
    row.append(this.input, send, talk);

    this.el.append(this.statusEl, this.modelField.el, ttsVoice.el, control.el, listen.el, watch.el, voice.el, ts.el, view.el, this.log, row);
    this.paintHeader();
    if ("speechSynthesis" in window) {
      speechSynthesis.getVoices();
      speechSynthesis.addEventListener("voiceschanged", () => speechSynthesis.getVoices());
    }
  }

  get controlOn(): boolean { return this.controlToggle.checked; }

  setControlFromServer(on: boolean): void {
    this.controlToggle.checked = on;
    localStorage.setItem(CONTROL_KEY, on ? "1" : "0");
    document.body.classList.toggle("ai-control", on);
    this.onControl?.(on);
  }

  /** Start always-on listening if the operator left the toggle on. Needs a click if the browser blocks it. */
  armWake(): void {
    void this.refreshStatus();
    if (this.wakeOn) this.startWake();
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

  mountSettings(host: HTMLElement): void {
    host.appendChild(this.el);
  }

  private async refreshStatus(): Promise<void> {
    try {
      const r = await apiFetch("/api/ai/status");
      if (!r.ok) {
        this.statusEl.textContent = r.status === 404
          ? "This monitor has no AI routes — restart the monitor process to load the current code."
          : `AI status failed (${r.status}).`;
        return;
      }
      const d = await r.json() as {
        ok?: boolean; error?: string; hasGemma?: boolean; model?: string; host?: string; models?: string[]; tts?: string;
      };
      this.ttsEngine = String(d.tts || "");
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
      this.statusEl.textContent = "Ollama status unknown — is the monitor up?";
    }
  }

  private append(role: string, text: string): void {
    const p = document.createElement("p");
    p.textContent = `${role}: ${text}`;
    this.log.appendChild(p);
    this.log.scrollTop = this.log.scrollHeight;
  }

  private paintHeader(): void {
    this.headerBtn.classList.toggle("listening", this.wakeOn && !this.busy);
    this.headerBtn.classList.toggle("busy", this.busy);
    if (!this.wakeOn) {
      this.headerBtn.textContent = "AI";
      this.headerBtn.title = "open the local agent";
      return;
    }
    if (this.busy) {
      this.headerBtn.textContent = "AI · speak";
      this.headerBtn.title = "speaking a reply";
      return;
    }
    if (this.command !== null) {
      this.headerBtn.textContent = "AI · …";
      this.headerBtn.title = "heard the watchword — keep talking";
      return;
    }
    this.headerBtn.textContent = "AI · listen";
    this.headerBtn.title = `listening for “${watchword()}”`;
  }

  private speechEngine(): (new () => SpeechRec) | null {
    const w = window as unknown as { SpeechRecognition?: new () => SpeechRec; webkitSpeechRecognition?: new () => SpeechRec };
    return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
  }

  private startWake(): void {
    if (!this.wakeOn || this.busy || this.holdTalk) return;
    const SR = this.speechEngine();
    if (!SR) {
      this.append("agent", "this browser has no speech recognition — Chromium on localhost is required");
      return;
    }
    this.stopRec();
    unlockSpeech();
    const rec = new SR();
    rec.lang = "en-US";
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (e) => this.onHear(e);
    rec.onerror = (e) => {
      if (e.error === "no-speech" || e.error === "aborted") return;
      if (e.error === "not-allowed") this.append("agent", "mic permission denied — allow the microphone for watchword listening");
    };
    rec.onend = () => {
      this.rec = null;
      if (this.wakeOn && !this.busy && !this.holdTalk) {
        this.restart = window.setTimeout(() => this.startWake(), 250);
      }
    };
    try {
      rec.start();
      this.rec = rec;
      this.paintHeader();
    } catch {
      this.headerBtn.title = "click AI to start watchword listening (browser blocked the mic)";
    }
  }

  private stopWake(): void {
    this.command = null;
    window.clearTimeout(this.silence);
    window.clearTimeout(this.restart);
    this.stopRec();
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
    this.stopRec();
    const SR = this.speechEngine();
    if (!SR) { this.append("agent", "this browser has no speech recognition"); return; }
    const rec = new SR();
    rec.lang = "en-US";
    rec.interimResults = true;
    rec.continuous = false;
    rec.onresult = (e) => {
      const t = lastTranscript(e);
      if (t) this.input.value = t;
    };
    rec.onend = () => { this.rec = null; };
    try { rec.start(); this.rec = rec; } catch { this.holdTalk = false; }
  }

  private stopHold(): void {
    if (!this.holdTalk) return;
    this.holdTalk = false;
    this.rec?.stop();
    this.rec = null;
    void this.send().then(() => { if (this.wakeOn) this.startWake(); });
  }

  private onHear(e: SpeechResultEvent): void {
    if (this.busy || this.holdTalk) return;
    const said = lastTranscript(e, true);
    if (!said) return;
    if (this.command === null) {
      const rest = afterWatchword(said, watchword());
      if (rest === null) return;
      this.command = rest;
      this.paintHeader();
    } else {
      const extra = lastTranscript(e);
      if (extra) this.command = `${this.command} ${extra}`.trim();
    }
    window.clearTimeout(this.silence);
    this.silence = window.setTimeout(() => void this.flushCommand(), SILENCE_MS);
  }

  private async flushCommand(): Promise<void> {
    const text = (this.command || "").trim();
    this.command = null;
    this.paintHeader();
    if (!text) return;
    this.input.value = text;
    await this.send();
  }

  stopVoice(): void {
    this.holdTalk = false;
    this.stopWake();
    this.speakAbort?.abort();
    this.speakAbort = null;
    if ("speechSynthesis" in window) speechSynthesis.cancel();
    void apiFetch("/api/ai/speak", { method: "DELETE" });
  }

  private async send(): Promise<void> {
    const text = this.input.value.trim();
    if (!text) return;
    this.input.value = "";
    this.append("you", text);
    this.busy = true;
    this.stopRec();
    this.paintHeader();
    try {
      if (!csrfToken()) await bootSession();
      const msg: { role: "user" | "assistant"; content: string; images?: string[] } = { role: "user", content: text };
      if (localStorage.getItem("zoto-viz.aiView") === "1") {
        const frame = this.captureFrame?.();
        if (frame) msg.images = [frame];
      }
      this.history.push({ role: "user", content: text });
      const r = await apiFetch("/api/ai/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          redact: redaction.enabled,
          model: localStorage.getItem(MODEL_KEY) || this.modelField.value || "gemma4",
          messages: this.history.slice(-10).map((m, i, all) => i === all.length - 1 ? msg : m),
        }),
      });
      const raw = await r.text();
      if (!r.ok) {
        this.history.pop();
        this.append("agent", `chat failed (${r.status}): ${parseOllamaStream(raw) || r.statusText}`);
        return;
      }
      const reply = parseOllamaStream(raw);
      this.history.push({ role: "assistant", content: reply });
      this.append("agent", reply);
      const settingsPatch = extractSettings(reply);
      if (settingsPatch) {
        if (!this.controlOn) this.append("agent", "AI Control is off — settings were not applied");
        else this.onApplySettings?.(settingsPatch);
      }
      const yaml = extractYaml(reply);
      if (yaml) {
        const install = this.controlOn && confirm("Install this plugin draft?");
        const d = await apiFetch("/api/ai/plugin", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ yaml, install }),
        }).then((x) => x.json()) as { ok?: boolean; error?: string; installed?: boolean };
        this.append("agent", d.ok ? (d.installed ? "plugin installed" : "plugin draft is valid (enable AI Control to install)") : `plugin invalid: ${d.error}`);
      }
      await this.speak(reply);
    } catch (e) {
      this.append("agent", String(e));
    } finally {
      this.busy = false;
      this.paintHeader();
      if (this.wakeOn && !this.holdTalk) this.startWake();
    }
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
  const phrases = [...new Set([w, `hey ${w}`, `ok ${w}`, `okay ${w}`])].sort((a, b) => b.length - a.length);
  for (const p of phrases) {
    const i = said.indexOf(p);
    if (i < 0) continue;
    const before = i === 0 || said[i - 1] === " ";
    const after = i + p.length === said.length || said[i + p.length] === " ";
    if (!before || !after) continue;
    return said.slice(i + p.length).trim();
  }
  return null;
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

function parseOllamaStream(raw: string): string {
  const bits: string[] = [];
  const trimmed = raw.trim();
  if (trimmed.startsWith("{") && !trimmed.includes("\n")) {
    try {
      const j = JSON.parse(trimmed) as { message?: { content?: string }; error?: string };
      if (j.error) return j.error;
      if (j.message?.content) return j.message.content;
    } catch { /* fall through */ }
  }
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try {
      const j = JSON.parse(t) as { message?: { content?: string }; error?: string };
      if (j.error) return j.error;
      if (j.message?.content) bits.push(j.message.content);
    } catch {
      bits.push(t);
    }
  }
  return bits.join("") || raw.slice(0, 2000);
}

export function extractYaml(text: string): string | null {
  const tagged = text.match(/```(?:ya?ml)\n([\s\S]+?)```/i);
  if (tagged) return tagged[1]!.trim();
  const bare = text.match(/```\n([\s\S]+?)```/);
  if (bare && /^\s*id:\s/m.test(bare[1]!)) return bare[1]!.trim();
  return null;
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

interface SpeechRec {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
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
