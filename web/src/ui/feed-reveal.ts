/** Characters revealed per second for agent replies — close to spoken pace. */
export const FEED_REVEAL_CPS = 36;
/** Chain-of-thought can run ahead of speech. */
export const FEED_THINK_CPS = 64;

/** Paint `budget` more of `want` onto `shown`, preferring a word boundary. */
export function revealStep(want: string, shown: string, dt: number, cps: number): string {
  if (want === shown) return shown;
  if (!want.startsWith(shown)) shown = "";
  const remain = want.slice(shown.length);
  if (!remain) return want;
  const n = Math.min(remain.length, Math.max(1, Math.round(cps * Math.max(0, dt))));
  let take = n;
  if (take < remain.length) {
    const slice = remain.slice(0, take);
    const sp = slice.lastIndexOf(" ");
    if (sp >= 1) take = sp + 1;
  }
  return shown + remain.slice(0, take);
}

/** Pixels per second while the ticker scrolls a queued backlog into view. */
export const FEED_SCROLL_PPS = 200;

/**
 * Advance `scrollTop` toward the latest line at a capped speed so new rows
 * stay queued below the viewport until the ticker catches up.
 */
export function followScrollTop(
  scrollTop: number,
  scrollHeight: number,
  clientHeight: number,
  dt: number,
): number {
  const max = Math.max(0, scrollHeight - clientHeight);
  if (clientHeight < 8) return scrollTop;
  const gap = max - scrollTop;
  if (gap <= 0.5) return max;
  const step = FEED_SCROLL_PPS * Math.max(0, dt);
  return Math.min(max, scrollTop + step);
}
