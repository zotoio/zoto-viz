type Loader = { import: (spec: string) => Promise<unknown> };

export async function loadVia(loader: Loader, spec: string) {
  return loader.import(spec);
}
