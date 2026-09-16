type Node = { id: string; rate: number; role: string };

declare const zoto: {
  onTick: ((nodes: Node[]) => void) | null;
  setStyle: (s: Record<string, unknown>) => void;
};

zoto.onTick = (_nodes) => {
  // Zip-contract fixture: no visual effect.
};
