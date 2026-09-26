const zoto = { getConfig: () => ({}), onFrame: null as ((f: unknown) => void) | null };

zoto.onFrame = (frame) => {
  const cfg = zoto.getConfig();
  void cfg;
  void frame;
};
