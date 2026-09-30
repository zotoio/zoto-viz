import { getVizZoto } from "plugins/sdk/viz-zoto";

const host = getVizZoto();
host.onFrame = (frame) => {
  host.writeUniform("uBright", 0.8 + frame.audio * 0.2);
  // The sky and the host preamble declare uAccent, but plugin.yml viz.uniforms doesn't list it,
  // so VizBufferWriter.writeUniform returns ok:false and the host drops the write.
  host.writeUniform("uAccent", [0.2, 0.6, 1.0]);
};
