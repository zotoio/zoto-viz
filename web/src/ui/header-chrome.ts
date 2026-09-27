/** Header VIEW is solo-only. A mosaic wall already picks a view on every pane. */
export function setHeaderViewVisible(visible: boolean): void {
  const box = document.getElementById("modeBox");
  const opts = document.getElementById("modeOpts");
  if (box) box.hidden = !visible;
  if (opts) opts.hidden = !visible;
}
