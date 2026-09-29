/**
 * Load every mosaic tile's sky at once and settle each pane as soon as its own load ends, so one
 * held sky never keeps the other panes in their warming state. Rejects with the first failure after
 * every load has ended. A superseded sync (aborted signal) settles nothing; the newest sync decides.
 */
export async function loadTilesSettlingEach(
  ids: readonly string[],
  signal: AbortSignal,
  load: (id: string) => Promise<void>,
  settle: (id: string) => void,
): Promise<void> {
  const loads = [...ids].map(async (id) => {
    signal.throwIfAborted();
    try {
      await load(id);
    } finally {
      if (!signal.aborted) settle(id);
    }
  });
  const failed = (await Promise.allSettled(loads)).find((r) => r.status === "rejected");
  if (failed) throw (failed as PromiseRejectedResult).reason;
}
