/** Host-side flag: keep demo-pack UBO across a viz-pack swap until consumed or consent denies. */
let preserveVizUbo = false;

export function setPreserveVizUbo(on: boolean): void {
  preserveVizUbo = on;
}

export function peekPreserveVizUbo(): boolean {
  return preserveVizUbo;
}

/** Read for bind path; clears after read (same as former main.ts consume). */
export function takePreserveVizUbo(): boolean {
  const v = preserveVizUbo;
  preserveVizUbo = false;
  return v;
}
