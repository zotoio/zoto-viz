import { beforeEach, describe, expect, it } from "vitest";
import { syncPackScopeNote } from "../plugins/plugin-ui";
import { loadSettingsDeclFixture } from "../plugins/test/load-settings-fixture";
import type { PackWallScope } from "../plugins/instances";

const PACK = "plugin:settings-fixture";
const NOTE_SEL = ".plugin-pack-scope-note";

function pinNoteWrites(host: ParentNode): { writes: () => number; pinned: () => void } {
  const note = host.querySelector<HTMLElement>(NOTE_SEL);
  if (!note) throw new Error(`missing ${NOTE_SEL}`);
  let writes = 0;
  let desc: PropertyDescriptor | undefined;
  for (let p: object | null = note; p; p = Object.getPrototypeOf(p)) {
    desc = Object.getOwnPropertyDescriptor(p, "textContent");
    if (desc?.get && desc?.set) break;
  }
  if (!desc?.get || !desc?.set) throw new Error("textContent accessor missing");
  Object.defineProperty(note, "textContent", {
    configurable: true,
    get(): string | null { return desc!.get!.call(this) as string | null; },
    set(v: string | null): void { writes += 1; desc!.set!.call(this, v); },
  });
  return {
    writes: () => writes,
    pinned: () => {
      if (!note.isConnected || note !== host.querySelector(NOTE_SEL)) throw new Error("scope note unpinned");
    },
  };
}

describe("duplicate slot shared config > pack scope note sync", () => {
  beforeEach(() => {
    expect.hasAssertions();
  });

  it("600 repeat syncs with unchanged copy: 0 note writes; one tile-count change: 1 write", () => {
    const spec = loadSettingsDeclFixture();
    const host = document.createElement("div");
    const view = document.createElement("div");
    view.className = "plugin-layer";
    view.dataset.layer = "view";
    view.append(Object.assign(document.createElement("div"), { className: "sec-title", textContent: "View" }));
    host.append(view);
    document.body.append(host);

    const wallTwo: PackWallScope = {
      tileModeIds: [PACK, `${PACK}!1`, "plugin:topology"],
      mosaicOn: true,
    };
    syncPackScopeNote(host, spec, wallTwo);
    const pin = pinNoteWrites(host);

    for (let i = 0; i < 600; i++) syncPackScopeNote(host, spec, wallTwo);
    pin.pinned();
    expect(pin.writes()).toBe(0);

    syncPackScopeNote(host, spec, {
      tileModeIds: [PACK, `${PACK}!1`, `${PACK}!2`, "plugin:topology"],
      mosaicOn: true,
    });
    pin.pinned();
    expect(pin.writes()).toBe(1);
    host.remove();
  });
});
