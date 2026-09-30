import { pulse } from "./helper.js";
import fixture from "./fixture.js";

const z = globalThis.zoto;

z.onPresent = () => {
  z.writeUniform("uBright", fixture.bright * pulse());
};
