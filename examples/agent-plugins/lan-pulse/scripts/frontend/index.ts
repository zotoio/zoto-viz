type Node = { id: string; rate: number; role: string };

declare const zoto: {
  onTick: ((nodes: Node[]) => void) | null;
  setStyle: (s: Record<string, unknown>) => void;
};

/** Frontend interface: map consumed device rates onto graph.style heat. */
export function heatFrom(nodes: Node[]): number {
  let sum = 0;
  for (const n of nodes) sum += n.rate;
  return Math.min(1, sum / Math.max(1, nodes.length) / 200);
}

let last = 0;
zoto.onTick = (nodes) => {
  const heat = heatFrom(nodes);
  if (Math.abs(heat - last) < 0.02) return;
  last = heat;
  zoto.setStyle({ heat });
};
