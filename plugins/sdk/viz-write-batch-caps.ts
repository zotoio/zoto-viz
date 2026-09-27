/** Sandbox viz.write batch limits (must match web/src/plugins/viz-write-batch.ts). */

export const VIZ_WRITE_BATCH_MAX_BYTES = 4096;
export const VIZ_WRITE_BATCH_MAX_MESSAGES = 32;

export function vizWriteBatchBufferBytes(dataLength: number): number {
  return dataLength * 8 + 16;
}

export function vizWriteBatchUniformBytes(): number {
  return 32 + 8;
}

export function vizWriteBatchParticlesBytes(dataLength: number): number {
  return dataLength * 8 + 16;
}

export type VizWriteBatchReserve = { messages: number; bytes: number };

export function canAddBatchBuffer(
  reserve: VizWriteBatchReserve,
  dataLength: number,
): boolean {
  const messages = reserve.messages + 1;
  const bytes = reserve.bytes + vizWriteBatchBufferBytes(dataLength);
  return messages <= VIZ_WRITE_BATCH_MAX_MESSAGES && bytes <= VIZ_WRITE_BATCH_MAX_BYTES;
}
