import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB_SRC = join(import.meta.dirname, "..");

function walkTs(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walkTs(p, out);
    else if (name.endsWith(".ts") && !name.endsWith(".test.ts")) out.push(p);
  }
  return out;
}

describe("ContextGen brand lint", () => {
  it("only the mint module may cast to ContextGen", () => {
    const offenders: string[] = [];
    const mint = join(WEB_SRC, "graph/context-gen.mint.ts");
    for (const file of walkTs(WEB_SRC)) {
      if (file === mint) continue;
      const text = readFileSync(file, "utf8");
      if (/\bas ContextGen\b/.test(text)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });
});
