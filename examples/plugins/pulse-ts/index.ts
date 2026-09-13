type Node = { id: string; rate: number; role: string };

declare const zoto: {
  onTick: ((nodes: Node[]) => void) | null;
  setStyle: (s: Record<string, unknown>) => void;
};

let last = 0;
zoto.onTick = (nodes) => {
  let sum = 0;
  for (const n of nodes) sum += n.rate;
  const heat = Math.min(1, sum / Math.max(1, nodes.length) / 200);
  if (Math.abs(heat - last) < 0.02) return;
  last = heat;
  zoto.setStyle({ heat });
};
