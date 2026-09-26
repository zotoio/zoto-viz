export const PACK_SCOPE_NOTE_SELECTOR = ".plugin-pack-scope-note";

export type PackScopeNoteWritePin = {
  note: HTMLElement;
  selector: string;
  writeCount: () => number;
  assertStillPinned: () => void;
};

function assertPinned(host: ParentNode, note: HTMLElement, selector: string): void {
  if (!note.isConnected) throw new Error("scope note node detached");
  if (note !== host.querySelector(selector)) throw new Error("scope note node replaced in DOM");
}

/** Pin one live scope-note node and count textContent writes from the test side. */
export function pinPackScopeNoteWriteCounter(host: ParentNode): PackScopeNoteWritePin {
  const selector = PACK_SCOPE_NOTE_SELECTOR;
  const note = host.querySelector<HTMLElement>(selector);
  if (!note) throw new Error(`missing ${selector}`);
  assertPinned(host, note, selector);

  let writes = 0;
  let desc: PropertyDescriptor | undefined;
  for (let p: object | null = note; p; p = Object.getPrototypeOf(p)) {
    desc = Object.getOwnPropertyDescriptor(p, "textContent");
    if (desc?.get && desc?.set) break;
  }
  if (!desc?.get || !desc?.set) throw new Error("textContent accessor missing on HTMLElement");

  Object.defineProperty(note, "textContent", {
    configurable: true,
    get(): string | null {
      return desc.get!.call(this) as string | null;
    },
    set(value: string | null): void {
      writes += 1;
      desc.set!.call(this, value);
    },
  });

  return {
    note,
    selector,
    writeCount: () => writes,
    assertStillPinned: () => assertPinned(host, note, selector),
  };
}
