import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  acquireSharedAudio, closeAudioContext, configureSharedAudio, createAudioContext,
  liveAudioContexts, releaseSharedAudio, resetAudioManagerForTests, withTimeout,
} from "./audio-manager";
import { playPcmStream } from "./tts";

class FakeCtx {
  static made = 0;
  state: "suspended" | "running" | "closed" = "suspended";
  currentTime = 0;
  destination = {};
  resumeHangs = false;
  static instances: FakeCtx[] = [];
  constructor() { FakeCtx.made++; FakeCtx.instances.push(this); }
  resume(): Promise<void> {
    if (FakeCtx.hang) return new Promise(() => undefined);
    this.state = "running"; return Promise.resolve();
  }
  suspend(): Promise<void> { this.state = "suspended"; return Promise.resolve(); }
  close(): Promise<void> { this.state = "closed"; return Promise.resolve(); }
  createBuffer(_c: number, n: number, rate: number) { const d = new Float32Array(n); return { duration: n / rate, getChannelData: () => d }; }
  createBufferSource() { return { buffer: null, connect() {}, disconnect() {}, start() {}, stop() {} }; }
  static hang = false;
}

beforeEach(() => {
  FakeCtx.made = 0; FakeCtx.hang = false; FakeCtx.instances = [];
  vi.stubGlobal("AudioContext", FakeCtx);
  resetAudioManagerForTests();
  configureSharedAudio({ idleSuspendMs: 50, resumeTimeoutMs: 30 });
});
afterEach(() => { resetAudioManagerForTests(); vi.unstubAllGlobals(); vi.useRealTimers(); });

function pcmResponse(chunks: number, hangAfter = false): Response {
  let i = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(c) {
      if (i < chunks) { i++; c.enqueue(new Uint8Array(4000)); return; }
      if (hangAfter) return new Promise(() => undefined);
      c.close();
    },
  });
  return new Response(body, { headers: { "content-type": "audio/pcm;rate=24000" } });
}

describe("audio-manager", () => {
  it("counts created and closed contexts, closing twice is safe", () => {
    const a = createAudioContext()!;
    createAudioContext();
    expect(liveAudioContexts()).toBe(2);
    closeAudioContext(a);
    closeAudioContext(a);
    expect(liveAudioContexts()).toBe(1);
  });

  it("withTimeout rejects a promise that never settles", async () => {
    await expect(withTimeout(new Promise(() => undefined), 10, "x")).rejects.toThrow(/timed out/);
    await expect(withTimeout(Promise.resolve(3), 10)).resolves.toBe(3);
  });

  it("reuses one shared context and suspends it when idle", async () => {
    const a = await acquireSharedAudio();
    const b = await acquireSharedAudio();
    expect(a).toBe(b);
    expect(FakeCtx.made).toBe(1);
    releaseSharedAudio(); releaseSharedAudio();
    await new Promise((r) => setTimeout(r, 80));
    expect(a).not.toBeNull();
    expect(FakeCtx.instances[0].state).toBe("suspended");
  });

  it("a resume that never settles yields null instead of pinning a context", async () => {
    FakeCtx.hang = true;
    expect(await acquireSharedAudio()).toBeNull();
    expect(liveAudioContexts()).toBe(1);
  });
});

describe("playPcmStream on the shared context", () => {
  it("many utterances create one AudioContext (was one per utterance)", async () => {
    for (let i = 0; i < 5; i++) await playPcmStream(pcmResponse(2));
    expect(FakeCtx.made).toBe(1);
    expect(liveAudioContexts()).toBe(1);
  });

  it("a stalled stream read is abandoned after the stall timeout", async () => {
    // resolves (instead of hanging until the test timeout) once the 40 ms stall timer fires
    await playPcmStream(pcmResponse(1, true), undefined, { stallMs: 40 });
    expect(liveAudioContexts()).toBe(1);
  });
});
