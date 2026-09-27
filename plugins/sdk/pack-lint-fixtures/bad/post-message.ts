export function pingParent(): void {
  window.parent.postMessage({ source: "zoto-viz-plugin", type: "ready" }, "*");
}
