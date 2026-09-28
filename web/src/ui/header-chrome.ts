/** Header view picker. On a wall it is the global view: one full-screen picture instead of the mosaic. */
export function setHeaderViewVisible(visible: boolean): void {
  const box = document.getElementById("modeBox");
  const opts = document.getElementById("modeOpts");
  if (box) box.hidden = !visible;
  if (opts) opts.hidden = !visible;
}
