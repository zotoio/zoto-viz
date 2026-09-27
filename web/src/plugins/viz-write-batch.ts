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

export function vizWriteBatchMessageCount(batch: VizWriteBatchPayload): number {
  return batch.buffers.length + batch.uniforms.length + (batch.particles ? 1 : 0);
}

export function validateVizWriteBatch(batch: VizWriteBatchPayload): string | null {
  const messages = vizWriteBatchMessageCount(batch);
  if (messages > VIZ_WRITE_BATCH_MAX_MESSAGES) {
    return `viz write batch ${messages} messages exceeds cap ${VIZ_WRITE_BATCH_MAX_MESSAGES}`;
  }
  const bytes = vizWriteBatchByteSize(batch);
  if (bytes > VIZ_WRITE_BATCH_MAX_BYTES) {
    return `viz write batch ${bytes} bytes exceeds cap ${VIZ_WRITE_BATCH_MAX_BYTES}`;
  }
  return null;
}

/** Split an accumulated frame batch into consecutive host-legal writeBatch payloads. */
export function splitVizWriteBatch(batch: VizWriteBatchPayload): VizWriteBatchPayload[] {
  type Item =
    | { kind: "buffer"; slot: number; data: number[] }
    | { kind: "uniform"; name: string; value: VizUniformValue }
    | { kind: "particles"; data: number[]; stride?: number };

  const items: Item[] = [];
  for (const b of batch.buffers) items.push({ kind: "buffer", slot: b.slot, data: b.data });
  for (const u of batch.uniforms) items.push({ kind: "uniform", name: u.name, value: u.value });
  if (batch.particles) {
    items.push({
      kind: "particles",
      data: batch.particles.data,
      stride: batch.particles.stride,
    });
  }

  const append = (dst: VizWriteBatchPayload, item: Item): VizWriteBatchPayload => {
    if (item.kind === "buffer") {
      return { ...dst, buffers: [...dst.buffers, { slot: item.slot, data: item.data }] };
    }
    if (item.kind === "uniform") {
      return { ...dst, uniforms: [...dst.uniforms, { name: item.name, value: item.value }] };
    }
    return { ...dst, particles: { data: item.data, stride: item.stride } };
  };

  const out: VizWriteBatchPayload[] = [];
  let cur = emptyVizWriteBatch();
  for (const item of items) {
    const trial = append(cur, item);
    if (validateVizWriteBatch(trial) !== null) {
      if (vizWriteBatchMessageCount(cur) > 0) out.push(cur);
      const single = append(emptyVizWriteBatch(), item);
      if (validateVizWriteBatch(single) !== null) {
        out.push(single);
        cur = emptyVizWriteBatch();
      } else {
        cur = single;
      }
      continue;
    }
    cur = trial;
  }
  if (vizWriteBatchMessageCount(cur) > 0) out.push(cur);
  return out;
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
