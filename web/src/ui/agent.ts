import { Toggle, TextField } from "./ui";
import { redaction } from "../core/redact";
import { setTsPluginsAllowed, tsPluginsAllowed } from "../plugins/host";
import { apiFetch, bootSession, csrfToken } from "../core/http";
import { playPcmStream } from "../audio/tts";
import { includeView, VIEW_KEY, type ViewCapture } from "./capture";

const CONTROL_KEY = "zoto-viz.aiControl";
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
  if (s.wakeOn && s.recOn !== false) return "listen";
  return "idle";
}

export function agentHeaderCopy(phase: AgentPhase, watch = DEFAULT_WATCH): { text: string; title: string } {
  switch (phase) {
    case "speak":
      return { text: "AI · speak", title: "speaking a reply" };
    case "think":
      return { text: "AI · think", title: "the local model is thinking" };
    case "heard":
      return { text: "AI · heard", title: "heard the watchword — keep talking" };
    case "listen":
      return { text: "AI · listen", title: `listening for “${watch}”` };
    default:
      return { text: "AI", title: "local agent idle" };
  }
}

export class AgentPanel {
  readonly el: HTMLDivElement;
  readonly headerBtn: HTMLButtonElement;
  private readonly led: HTMLSpanElement;
  private readonly log: HTMLDivElement;
  private readonly input: HTMLTextAreaElement;
  private readonly statusEl: HTMLDivElement;
  private rec: SpeechRec | null = null;
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
  private modelField!: TextField;
  private history: { role: "user" | "assistant"; content: string; thinking?: string }[] = [];
  private hydrateP: Promise<void> | null = null;
  private logEpoch = 0;
  private noVoiceHint = false;
  private voicesTried = false;
  private ttsEngine = "";
  private speakAbort: AbortController | null = null;
  onControl?: (on: boolean) => void;
  onOpen?: () => void;
  onApplySettings?: (patch: Record<string, unknown>) => void;
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
    this.headerBtn = document.createElement("button");
    this.headerBtn.type = "button";
    this.headerBtn.className = "toggle";
    this.led = document.createElement("span");
    this.led.className = "led";
    this.led.setAttribute("aria-hidden", "true");
    this.headerBtn.replaceChildren(this.led, document.createTextNode("AI"));
    this.headerBtn.title = "open the local agent · click to start watchword listening";
    this.headerBtn.addEventListener("click", () => {
      this.onOpen?.();
      void this.refreshStatus();
      if (!this.busy) void this.hydrate(true);
      if (this.wakeOn) this.startWake(true);
    });
    document.addEventListener("pointerdown", () => {
      if (this.wakeOn && !this.rec && !this.busy && !this.speaking && !this.holdTalk) this.startWake();
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
        if (on) this.startWake(true);
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
      label: "include screen",
      title: "attach a compact HUD snapshot of what is on screen (no image)",
      checked: includeView(),
      onChange: (on) => localStorage.setItem(VIEW_KEY, on ? "1" : "0"),
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
    const clear = document.createElement("button");
    clear.type = "button";
    clear.textContent = "clear";
    clear.title = "clear the on-screen log and stored transcript (memories stay)";
    clear.addEventListener("click", () => void this.clearHistory());
    const row = document.createElement("div");
    row.className = "agent-row";
    row.append(this.input, send, talk, clear);

    this.el.append(this.statusEl, this.modelField.el, ttsVoice.el, control.el, listen.el, watch.el, voice.el, ts.el, view.el, this.log, row);
    this.paintHeader();
    void this.hydrate();
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
    void this.hydrate();
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

  transcript(): { role: "user" | "assistant"; content: string; thinking?: string }[] {
    return this.history.slice();
  }

  private append(role: string, text: string): void {
    const p = document.createElement("p");
    if (role === "think") p.className = "think";
    p.textContent = `${role}: ${text}`;
    this.log.appendChild(p);
    this.log.scrollTop = this.log.scrollHeight;
  }

  private paintLog(): void {
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
    const { text, title } = agentHeaderCopy(phase, watchword());
    this.headerBtn.classList.toggle("listening", phase === "listen");
    this.headerBtn.classList.toggle("heard", phase === "heard");
    this.headerBtn.classList.toggle("thinking", phase === "think");
    this.headerBtn.classList.toggle("speaking", phase === "speak");
    this.headerBtn.classList.toggle("busy", phase === "think" || phase === "speak");
    this.headerBtn.setAttribute("aria-busy", phase === "think" || phase === "speak" ? "true" : "false");
    this.headerBtn.title = title;
    this.headerBtn.replaceChildren(this.led, document.createTextNode(text));
    document.body.classList.toggle("ai-thinking", phase === "think");
    this.onPhase?.(phase);
  }

  private speechEngine(): (new () => SpeechRec) | null {
    const w = window as unknown as { SpeechRecognition?: new () => SpeechRec; webkitSpeechRecognition?: new () => SpeechRec };
    return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
  }

  private startWake(restart = false): void {
    if (!this.wakeOn || this.busy || this.speaking || this.holdTalk) return;
    if (this.rec && !restart) return;
    const SR = this.speechEngine();
    if (!SR) {
      if (restart) this.append("agent", "this browser has no speech recognition — Chromium on localhost is required");
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
        this.headerBtn.title = "click AI to allow the microphone for watchword listening";
      }
    };
    rec.onend = () => {
      if (this.rec !== rec) return;
      this.rec = null;
      this.paintHeader();
      if (this.wakeOn && !this.busy && !this.speaking && !this.holdTalk && !this.micBlocked) {
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
    this.follow = "";
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
    this.follow = "";
    this.stopRec();
    const SR = this.speechEngine();
    if (!SR) { this.append("agent", "this browser has no speech recognition"); return; }
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
    void this.send().then(() => { if (this.wakeOn) this.startWake(); });
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
    window.clearTimeout(this.silence);
    const text = `${this.command || ""} ${this.follow}`.trim();
    if (text) {
      this.silence = window.setTimeout(() => void this.flushCommand(), SILENCE_MS);
    } else {
      this.silence = window.setTimeout(() => {
        this.command = null;
        this.follow = "";
        this.paintHeader();
      }, HEARD_WAIT_MS);
    }
  }

  private async flushCommand(): Promise<void> {
    const text = `${this.command || ""} ${this.follow}`.trim();
    this.command = null;
    this.follow = "";
    this.paintHeader();
    if (!text) return;
    this.input.value = text;
    await this.send(text);
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
      const r = await apiFetch("/api/ai/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          redact: redaction.enabled,
          model: localStorage.getItem(MODEL_KEY) || this.modelField.value || "gemma4",
          messages: this.history.slice(-10),
          ...(view ? { view: { hud: view } } : {}),
        }),
      });
      if (!r.ok) {
        const raw = await r.text();
        this.history.pop();
        const fail = parseOllamaChat(raw).content || r.statusText;
        this.append("agent", `chat failed (${r.status}): ${fail}`);
        this.onChat?.("agent", `chat failed (${r.status}): ${fail}`);
        return true;
      }
      const { thinking, content } = await this.readChat(r);
      reply = content;
      this.history.push({ role: "assistant", content: reply, thinking: thinking || undefined });
      if (thinking) this.append("think", thinking);
      this.append("agent", displayText(reply));
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
    if (this.wakeOn && !this.holdTalk) this.startWake();
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
  const stripped = reply.replace(/```memory\n[\s\S]*?```/gi, "").trim();
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
