/** Play s16le PCM as it arrives (ElevenLabs / Kokoro / Piper). */
import { acquireSharedAudio, releaseSharedAudio, withTimeout } from "./audio-manager";

export function pcmSampleRate(h: Headers): number {
  const n = Number(h.get("X-Zoto-Viz-Rate") || "");
  if (n >= 8000 && n <= 48000) return n;
  const m = /rate=(\d+)/i.exec(h.get("content-type") || "");
  const r = m ? Number(m[1]) : 0;
  return r >= 8000 && r <= 48000 ? r : 24000;
}

export function s16leToF32(bytes: Uint8Array): Float32Array {
  const n = bytes.byteLength >> 1;
  const view = new DataView(bytes.buffer, bytes.byteOffset, n * 2);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = view.getInt16(i * 2, true) / 32768;
  return out;
}

export function concatBytes(a: Uint8Array, b: Uint8Array): Uint8Array<ArrayBuffer> {
  const o = new Uint8Array(a.byteLength + b.byteLength);
  o.set(a, 0);
  o.set(b, a.byteLength);
  return o;
}

/** A stream read that delivers nothing for this long is treated as stalled and abandoned. */
export const TTS_STALL_MS = 10_000;

/**
 * Play a PCM response on the shared AudioContext (never one context per utterance: a hung
 * resume or stalled read used to skip the close and leak a real-time audio thread each time).
 */
export async function playPcmStream(
  r: Response,
  signal?: AbortSignal,
  opts: { stallMs?: number } = {},
): Promise<void> {
  if (!r.body) return;
  if (signal?.aborted) return;
  const rate = pcmSampleRate(r.headers);
  const reader = r.body.getReader();
  const ctx = await acquireSharedAudio();
  if (!ctx) {
    void reader.cancel().catch(() => undefined);
    return;
  }
  const sources: AudioBufferSourceNode[] = [];
  let leftover: Uint8Array<ArrayBuffer> = new Uint8Array(0);
  let next = ctx.currentTime + 0.05;
  const min = Math.max(2, Math.floor(rate * 0.08) * 2);
  const stallMs = opts.stallMs ?? TTS_STALL_MS;

  const stop = () => {
    for (const s of sources) {
      try { s.stop(); } catch { /* already stopped */ }
      try { s.disconnect(); } catch { /* already disconnected */ }
    }
    void reader.cancel().catch(() => undefined);
  };
  const onAbort = () => stop();
  signal?.addEventListener("abort", onAbort);

  try {
    while (!signal?.aborted) {
      const { value, done } = await withTimeout(reader.read(), stallMs, "TTS stream read");
      if (value?.byteLength) {
        const chunk = new Uint8Array(value.byteLength);
        chunk.set(value);
        leftover = concatBytes(leftover, chunk);
      }
      const even = leftover.byteLength - (leftover.byteLength % 2);
      if ((done || even >= min) && even >= 2) {
        const frame = leftover.slice(0, even);
        leftover = leftover.slice(even);
        next = enqueuePcm(ctx, s16leToF32(frame), rate, next, sources);
      }
      if (done) break;
    }
    const waitMs = Math.max(0, (next - ctx.currentTime) * 1000);
    await new Promise<void>((resolve) => {
      const id = window.setTimeout(resolve, waitMs);
      const early = () => { window.clearTimeout(id); resolve(); };
      signal?.addEventListener("abort", early, { once: true });
    });
  } catch {
    stop();
  } finally {
    signal?.removeEventListener("abort", onAbort);
    for (const s of sources) {
      try { s.disconnect(); } catch { /* already disconnected */ }
    }
    releaseSharedAudio();
  }
}

function enqueuePcm(
  ctx: AudioContext,
  samples: Float32Array,
  rate: number,
  when: number,
  sources: AudioBufferSourceNode[],
): number {
  if (!samples.length) return when;
  const buf = ctx.createBuffer(1, samples.length, rate);
  buf.getChannelData(0).set(samples);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.connect(ctx.destination);
  const start = Math.max(when, ctx.currentTime);
  src.start(start);
  sources.push(src);
  return start + buf.duration;
}
