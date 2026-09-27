import type { VizDataFrame } from "../viz-host";

/** Shared by collector tests — not used in production delivery. */
export function assertLinksMatchTalkers(frame: VizDataFrame): void {
  const ids = new Set(frame.talkers.map((t: { id: string }) => t.id));
  for (const link of frame.links ?? []) {
    if (!ids.has(link.src) || !ids.has(link.dst)) {
      throw new Error(`link ${link.src}->${link.dst} references ids outside talkers[]`);
    }
  }
}
