/**
 * Polls that only matter on screen (feed, debug log, inspect panes) skip their work while the
 * tab is hidden and catch up once when it becomes visible again.
 */
type Doc = {
  visibilityState: DocumentVisibilityState;
  addEventListener(type: "visibilitychange", fn: () => void): void;
  removeEventListener(type: "visibilitychange", fn: () => void): void;
};

export function tabHidden(doc: Pick<Document, "visibilityState"> | undefined = typeof document !== "undefined" ? document : undefined): boolean {
  return doc?.visibilityState === "hidden";
}

/**
 * Wrap `fn` so calls are skipped while hidden. A call skipped while hidden is replayed once on
 * the next `visibilitychange` to visible. `dispose()` removes the listener.
 */
export function visiblePoll(fn: () => void, doc: Doc | undefined = typeof document !== "undefined" ? document : undefined): (() => void) & { dispose(): void } {
  let missed = false;
  const onVis = () => {
    if (!tabHidden(doc) && missed) { missed = false; fn(); }
  };
  doc?.addEventListener("visibilitychange", onVis);
  const run = (() => {
    if (tabHidden(doc)) { missed = true; return; }
    fn();
  }) as (() => void) & { dispose(): void };
  run.dispose = () => doc?.removeEventListener("visibilitychange", onVis);
  return run;
}
