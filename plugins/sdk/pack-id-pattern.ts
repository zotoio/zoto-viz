/** Plugin id regex — must match schema/plugin.schema.json properties.id.pattern */
import { readFileSync } from "node:fs";
import path from "node:path";

const schemaPath = path.resolve(import.meta.dirname, "../../schema/plugin.schema.json");

export function packIdPatternFromSchema(): string {
  const raw = JSON.parse(readFileSync(schemaPath, "utf8")) as {
    properties?: { id?: { pattern?: string } };
  };
  const pattern = raw.properties?.id?.pattern;
  if (!pattern) throw new Error("schema plugin.id.pattern missing");
  return pattern;
}

export const PACK_ID_PATTERN = packIdPatternFromSchema();
export const PACK_ID_RE = new RegExp(PACK_ID_PATTERN);
