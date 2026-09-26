const spec = "../../../../web/src/plugins/host";

export async function loadDynamic() {
  return import(spec);
}
