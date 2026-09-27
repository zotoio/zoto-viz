import type { VizZoto } from "../../sdk/viz-zoto";

const zoto = globalThis.zoto as VizZoto;

zoto.onFrame = null;
