import type { NetScene } from "../graph/scene";
import { PongView } from "./pong";
import { InvadersView } from "./invaders";
import { CommandView } from "./command";
import { FroggerView } from "./frogger";
import { CpuPongView } from "./cpupong";
import { DoomView } from "./doom";
import { WavesView } from "./waves";
import { OrbitsView } from "./orbits";
import { HelixView } from "./helix";
import { SkylineView } from "./skyline";
import { PacmanView } from "./pacman";
import { TetrisView } from "./tetris";
import { PortalView } from "./portal";
import { CarouselView } from "./carousel";

export type ArcadeView = {
  start(preferIp?: string | null): void;
  stop(): void;
  update(m: import("../core/types").StateMsg): void;
  setTheme(t: import("../core/themes").Theme): void;
  setBind?(bind: Record<string, string>): void;
};

export type ArcadeSlot = { view: ArcadeView; el: HTMLElement };

const ENGINES: Record<string, (el: HTMLElement, scene: NetScene) => ArcadeView> = {
  netpong: (el, scene) => new PongView(el, scene),
  invaders: (el, scene) => new InvadersView(el, scene),
  command: (el, scene) => new CommandView(el, scene),
  frogger: (el, scene) => new FroggerView(el, scene),
  cpupong: (el, scene) => new CpuPongView(el, scene),
  doom: (el, scene) => new DoomView(el, scene),
  waves: (el, scene) => new WavesView(el, scene),
  orbits: (el, scene) => new OrbitsView(el, scene),
  helix: (el, scene) => new HelixView(el, scene),
  skyline: (el, scene) => new SkylineView(el, scene),
  pacman: (el, scene) => new PacmanView(el, scene),
  tetris: (el, scene) => new TetrisView(el, scene),
  portal: (el, scene) => new PortalView(el, scene),
  carousel: (el, scene) => new CarouselView(el, scene),
};

/** Fresh arcade stage for one mosaic tile. Full-screen mode keeps the shipped singletons. */
export function spawnArcade(engine: string, scene: NetScene): ArcadeSlot | null {
  const make = ENGINES[engine];
  if (!make) return null;
  const el = document.createElement("div");
  el.className = `arcade mosaic-live ${engine}`;
  el.hidden = false;
  return { view: make(el, scene), el };
}
