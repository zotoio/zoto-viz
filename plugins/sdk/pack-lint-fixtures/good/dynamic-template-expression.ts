const base = "./scenes";

export async function loadScene(name: string) {
  return import(`${base}/${name}`);
}
