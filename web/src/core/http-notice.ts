import { SERVER_RESTART_NOTICE } from "./http-copy";
import { clearWallNotices, showWallRetryNotice, showWallStatusNotice } from "./wall-notice";

const AUTO_CLEAR_MS = 8000;

type RetryFailedDetail = { message: string; retry: () => void | Promise<void> };

/** Wire restart / retry-failure copy into the mosaic wall notice strip. */
export function bindServerRestartWallNotice(): () => void {
  const host = document.getElementById("wall");
  if (!host) return () => {};

  let clearTimer: ReturnType<typeof setTimeout> | undefined;

  const clearNotice = () => {
    clearTimeout(clearTimer);
    clearTimer = undefined;
    clearWallNotices();
    window.dispatchEvent(new Event("zoto-viz-server-restart-cleared"));
  };

  const armAutoClear = (el: HTMLElement) => {
    clearTimeout(clearTimer);
    clearTimer = setTimeout(() => clearNotice(), AUTO_CLEAR_MS);
    el.addEventListener("click", (e) => {
      if ((e.target as HTMLElement).closest("button")) return;
      clearNotice();
    });
  };

  const onRestart = (e: Event) => {
    const msg = (e as CustomEvent<string>).detail;
    if (msg !== SERVER_RESTART_NOTICE) return;
    const el = showWallStatusNotice(msg);
    if (!el) return;
    armAutoClear(el);
  };

  const onRetryFailed = (e: Event) => {
    const detail = (e as CustomEvent<RetryFailedDetail>).detail;
    if (!detail?.message) return;
    clearTimeout(clearTimer);
    clearTimer = undefined;
    showWallRetryNotice(detail.message, detail.retry);
  };

  window.addEventListener("zoto-viz-server-restart", onRestart);
  window.addEventListener("zoto-viz-mutate-retry-failed", onRetryFailed);
  return () => {
    window.removeEventListener("zoto-viz-server-restart", onRestart);
    window.removeEventListener("zoto-viz-mutate-retry-failed", onRetryFailed);
    clearNotice();
  };
}
