/** Keys referenced by the starter sim — must appear in data-mapping.yml. */
export const USED_MAPPING_FIELDS = [
  "talkers[].rate",
  "talkers[].id",
  "sys.failed",
  "demo",
] as const;

export function parseDeclaredMappingFields(yamlText: string): string[] {
  const out: string[] = [];
  for (const line of yamlText.split("\n")) {
    const m = line.match(/^\s*-\s*field:\s*(.+)\s*$/);
    if (m) out.push(m[1]!.trim());
  }
  return out;
}

export function missingLegendEntries(declared: string[], used: readonly string[]): string[] {
  const set = new Set(declared);
  return used.filter((k) => !set.has(k));
}
