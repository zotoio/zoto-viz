export type MainEntryTestHooks = {
  connect: () => void;
  bootCatalog: () => Promise<void>;
};

let hooks: MainEntryTestHooks | null = null;

export function registerMainEntryTestHooks(h: MainEntryTestHooks): void {
  hooks = h;
}

export function mainEntryTestConnect(): void {
  if (!hooks) throw new Error("main entry test hooks not registered");
  hooks.connect();
}

export async function mainEntryTestBootCatalog(): Promise<void> {
  await hooks?.bootCatalog();
}
