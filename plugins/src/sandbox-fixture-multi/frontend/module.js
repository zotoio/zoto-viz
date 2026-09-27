import { pulse } from "./helper.js";
import fixture from "./fixture.json" with { type: "json" };

const z = globalThis.zoto;

z.onPresent = () => {
  z.writeUniform("uBright", fixture.bright * pulse());
};
