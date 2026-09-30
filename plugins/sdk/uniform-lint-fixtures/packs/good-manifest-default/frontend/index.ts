import { getVizZoto } from "plugins/sdk/viz-zoto";

const host = getVizZoto();
host.onFrame = (frame) => {
  host.writeUniform("uRenderScale", 1);
  host.writeUniform("uAudio", frame.audio);
};
