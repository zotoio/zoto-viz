/** Wire restart recovery copy into the HUD hint line. */

export function bindServerRestartNoticeToHint(): () => void {
  const hint = document.getElementById("hint");
  if (!hint) return () => {};
  const onRestart = (e: Event) => {
    const msg = (e as CustomEvent<string>).detail;
    if (msg) hint.textContent = msg;
  };
  window.addEventListener("zoto-viz-server-restart", onRestart);
  return () => window.removeEventListener("zoto-viz-server-restart", onRestart);
}
