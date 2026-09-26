import type { ContextGen } from "./context-gen.mint";
import {
  contextCacheHit,
  contextCacheKey,
  type ContextCacheKey,
} from "./context-cache-key";
import { parseNixieLook } from "../../../plugins/src/nixie-clock/frontend/tubes";

function nixieUploadTimeKey(tSec: number, look: Record<string, string>): number {
  const parsed = parseNixieLook(look);
  const d = new Date(tSec * 1000);
  let h = d.getHours();
  const m = d.getMinutes();
  const s = d.getSeconds();
  if (parsed.hour12) {
    h = h % 12;
    if (h === 0) h = 12;
  }
  return parsed.seconds ? h * 3600 + m * 60 + s : h * 3600 + m * 60;
}

function letterboxKey(w: number, h: number, clearHex: number): string {
  return `${w}x${h}@${clearHex}`;
}

/** One wall-level nixie UBO upload per distinct cache key. */
export class NixieUploadCache {
  private last: ContextCacheKey<number> | null = null;

  upload(gen: ContextGen, tSec: number, look: Record<string, string>, doUpload: () => void): boolean {
    const next = contextCacheKey(gen, nixieUploadTimeKey(tSec, look));
    if (contextCacheHit(this.last, next)) return false;
    this.last = next;
    doUpload();
    return true;
  }
}

/** Letterbox viewport fill — shared across tiles with the same geometry. */
export class LetterboxFillCache {
  private last: ContextCacheKey<string> | null = null;

  rebuild(
    gen: ContextGen,
    w: number,
    h: number,
    clearHex: number,
    doRebuild: () => void,
  ): boolean {
    const next = contextCacheKey(gen, letterboxKey(w, h, clearHex));
    if (contextCacheHit(this.last, next)) return false;
    this.last = next;
    doRebuild();
    return true;
  }
}

type UniformScalar = number | readonly [number, number, number];

function uniformKey(name: string, value: UniformScalar): string {
  if (Array.isArray(value)) return `${name}:${value.join(",")}`;
  return `${name}:${value}`;
}

/** Change-only uniform uploads (host GL mirror). */
export class UniformUploadCache {
  private readonly last = new Map<string, ContextCacheKey<string>>();

  upload(gen: ContextGen, name: string, value: UniformScalar, doUpload: () => void): boolean {
    const next = contextCacheKey(gen, uniformKey(name, value));
    const prev = this.last.get(name) ?? null;
    if (contextCacheHit(prev, next)) return false;
    this.last.set(name, next);
    doUpload();
    return true;
  }
}
