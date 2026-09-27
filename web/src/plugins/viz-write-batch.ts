import type { VizUniformValue } from "./viz-host";
import type { VizBufferWriter } from "./viz-host";

/** One sandbox → host viz payload per display frame (budget enforced on apply). */
export type VizWriteBatchPayload = {
  buffers: { slot: number; data: number[] }[];
  uniforms: { name: string; value: VizUniformValue }[];
  particles?: { data: number[]; stride?: number };
};

export const VIZ_WRITE_BATCH_MAX_BYTES = 4096;
export const VIZ_WRITE_BATCH_MAX_MESSAGES = 32;

export function vizWriteBatchByteSize(batch: VizWriteBatchPayload): number {
  let n = 0;
  for (const b of batch.buffers) n += b.data.length * 8 + 16;
  for (const u of batch.uniforms) {
    n += 32 + (typeof u.value === "number" ? 8 : 24);
  }
  if (batch.particles) n += batch.particles.data.length * 8 + 16;
  return n;
}

export function emptyVizWriteBatch(): VizWriteBatchPayload {
  return { buffers: [], uniforms: [] };
}

export function validateVizWriteBatch(batch: VizWriteBatchPayload): string | null {
  const messages = batch.buffers.length + batch.uniforms.length + (batch.particles ? 1 : 0);
  if (messages > VIZ_WRITE_BATCH_MAX_MESSAGES) {
    return `viz write batch ${messages} messages exceeds cap ${VIZ_WRITE_BATCH_MAX_MESSAGES}`;
  }
  const bytes = vizWriteBatchByteSize(batch);
  if (bytes > VIZ_WRITE_BATCH_MAX_BYTES) {
    return `viz write batch ${bytes} bytes exceeds cap ${VIZ_WRITE_BATCH_MAX_BYTES}`;
  }
  return null;
}

export function applyVizWriteBatch(
  writer: VizBufferWriter,
  batch: VizWriteBatchPayload,
  handlers: {
    onBuffer?: () => void;
    onUniform?: (name: string, value: VizUniformValue) => void;
  },
): boolean {
  const err = validateVizWriteBatch(batch);
  if (err) {
    console.warn("zoto-viz viz.write batch:", err);
    return false;
  }
  let ok = true;
  for (const b of batch.buffers) {
    const res = writer.writeBuffer(b.slot, b.data);
    if (!res.ok) ok = false;
    else handlers.onBuffer?.();
  }
  for (const u of batch.uniforms) {
    const res = writer.writeUniform(u.name, u.value);
    if (!res.ok) ok = false;
    else handlers.onUniform?.(u.name, u.value);
  }
  if (batch.particles) writer.writeParticles(batch.particles.data, batch.particles.stride);
  return ok;
}
