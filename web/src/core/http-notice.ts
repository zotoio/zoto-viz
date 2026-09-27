import { SERVER_RESTART_NOTICE } from "./http-copy";
import { postWallNotice, type WallNoticeHandle } from "./wall-notice-region";

const AUTO_CLEAR_MS = 8000;

type RetryFailedDetail = { message: string; retry: () => void | Promise<void> };

/** Wire restart / retry-failure copy into the shared wall notice region. */
export function bindServerRestartWallNotice(): () => void {
  const wall = document.getElementById("wall");
  if (!wall) return () => {};

  let clearTimer: ReturnType<typeof setTimeout> | undefined;
  let restartHandle: WallNoticeHandle | undefined;

  const emitRestartCleared = () => {
    window.dispatchEvent(new Event("zoto-viz-server-restart-cleared"));
  };

  const clearRestartNotice = () => {
    clearTimeout(clearTimer);
    clearTimer = undefined;
    if (restartHandle?.live) restartHandle.dismiss();
    restartHandle = undefined;
    emitRestartCleared();
  };

  const armAutoClear = () => {
    clearTimeout(clearTimer);
    clearTimer = setTimeout(() => clearRestartNotice(), AUTO_CLEAR_MS);
  };

  const onWallClick = (e: MouseEvent) => {
    const row = (e.target as HTMLElement).closest('[data-notice-key="server-restarted"]');
    if (!row) return;
    if ((e.target as HTMLElement).closest("button")) return;
    clearRestartNotice();
  };

  const onRestart = (e: Event) => {
    const msg = (e as CustomEvent<string>).detail;
    if (msg !== SERVER_RESTART_NOTICE) return;
    restartHandle = postWallNotice({
      key: "server-restarted",
      text: msg,
    });
    armAutoClear();
  };

  const onRetryFailed = (e: Event) => {
    const detail = (e as CustomEvent<RetryFailedDetail>).detail;
    if (!detail?.message) return;
    clearTimeout(clearTimer);
    clearTimer = undefined;
    if (restartHandle?.live) restartHandle.dismiss();
    restartHandle = undefined;
    postWallNotice({
      key: "retry-failed",
      text: detail.message,
      action: { label: "Retry", onClick: () => { void detail.retry(); } },
    });
  };

  wall.addEventListener("click", onWallClick);
  window.addEventListener("zoto-viz-server-restart", onRestart);
  window.addEventListener("zoto-viz-mutate-retry-failed", onRetryFailed);
  return () => {
    wall.removeEventListener("click", onWallClick);
    window.removeEventListener("zoto-viz-server-restart", onRestart);
    window.removeEventListener("zoto-viz-mutate-retry-failed", onRetryFailed);
    clearTimeout(clearTimer);
    clearTimer = undefined;
    if (restartHandle?.live) restartHandle.dismiss();
    restartHandle = undefined;
  };
}
