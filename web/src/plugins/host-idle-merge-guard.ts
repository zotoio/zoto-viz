import type { StateMsg } from "../core/types";

export type HostIdleTarget =
  | { kind: "main" }
  | { kind: "view"; base: string };

function viewSliceEmpty(state: StateMsg, target: HostIdleTarget): boolean {
  if (target.kind === "view") {
    return (state.views?.[target.base]?.devices?.length ?? 0) === 0;
  }
  const active = state.devices.filter((d) => d.online && d.packets > 0 && d.role !== "multicast");
  return active.length < 3 && (state.flows?.length ?? 0) < 2;
}

/** When true, live capture already fills the slot — do not merge host golden slices. */
export function shouldSkipHostIdleMerge(live: StateMsg, target: HostIdleTarget): boolean {
  return !viewSliceEmpty(live, target);
}
