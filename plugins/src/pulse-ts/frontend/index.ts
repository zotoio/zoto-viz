import { getVizZoto } from "plugins/sdk/viz-zoto";

const host = getVizZoto();
type Node = { id: string; rate: number; role: string };


let last = 0;
host.onTick = (nodes) => {
  let sum = 0;
  for (const n of nodes) sum += n.rate;
  const heat = Math.min(1, sum / Math.max(1, nodes.length) / 200);
  if (Math.abs(heat - last) < 0.02) return;
  last = heat;
  host.setStyle?.({ heat });
};
