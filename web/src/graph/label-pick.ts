/** Which graph nodes carry a floating label. Pure, so the rules are testable without a scene. */

export interface LabelCandidate {
  id: string;
  role: string;
  bytes: number;
  rate: number;
}

const busiest = (a: LabelCandidate, b: LabelCandidate): number => b.bytes - a.bytes || b.rate - a.rate;

/**
 * Nodes labelled by role while labels are on: this host, the gateway, and the busiest LAN and
 * internet nodes (up to `cap` each). A graph with no LAN or internet nodes (CPU cores, memory,
 * units, plugin graphs) has none of those roles, so its busiest nodes of any role are labelled
 * instead (up to `cap`); otherwise turning labels on there showed nothing but the hub.
 */
export function roleLabelIds(visible: readonly LabelCandidate[], cap: number): Set<string> {
  const lan: LabelCandidate[] = [];
  const net: LabelCandidate[] = [];
  const other: LabelCandidate[] = [];
  const keep = new Set<string>();
  for (const n of visible) {
    if (n.role === "self" || n.role === "gateway") keep.add(n.id);
    else if (n.role === "lan" || n.role === "local") lan.push(n);
    else if (n.role === "internet") net.push(n);
    else other.push(n);
  }
  const take = (list: LabelCandidate[]) => {
    for (const n of list.sort(busiest).slice(0, Math.max(0, cap))) keep.add(n.id);
  };
  take(lan);
  take(net);
  if (lan.length + net.length === 0) take(other);
  return keep;
}

/**
 * A node's label shows when it is hovered or selected (even with labels off: pointing at a node
 * names it), or when labels are on and it is fresh, forced by the view, or kept by role and not
 * suppressed by the view.
 */
export function labelVisible(o: {
  visible: boolean;
  focused: boolean;
  labelsOn: boolean;
  live: boolean;
  forced: boolean;
  byRole: boolean;
  suppressed: boolean;
}): boolean {
  if (!o.visible) return false;
  if (o.focused) return true;
  return o.labelsOn && (o.live || o.forced || (o.byRole && !o.suppressed));
}
