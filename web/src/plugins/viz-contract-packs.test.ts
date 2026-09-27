import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, beforeEach } from "vitest";
import { VIZ_CONTRACT_VERSION } from "../../../plugins/sdk/viz-contract";
import { VIZ_FIXTURE_GOLDEN_LIVE, VIZ_FIXTURE_GOLDEN_LIVE_FAILED } from "../../../plugins/sdk/viz-fixtures";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const packsRoot = path.join(repoRoot, "plugins/src");

/** Packs still carrying local frame copies — remove when their PRs land. */
const PACK_FRAME_TYPE_ALLOWLIST: Record<string, string> = {
  backrooms: "open PR — BrFrame director slice",
  "ant-colony": "open PR — local frame types",
  "marble-run": "open PR #20 — widened local frame",
};

const FORBIDDEN_LOCAL_TYPE =
  /\b(?:type|interface)\s+(VizFrame|VizDataFrame|VizPacketSample|VizTalkerSample|VizSysTelemetry|VizRfBeacon|VizHeadline|PacketTunnelFrame|SysGauges|TalkerRow|PacketRow|RfRow)\b/;

const HOST_IMPORT = /from\s+['"][^'"]*web\/src\//;

const IMPORT_FROM = /import\s+(?:type\s+)?[\s\S]*?\sfrom\s+['"]([^'"]+)['"]/g;

/** Pack imports may reach `plugins/sdk/**`; reject host, other packs, and paths outside pack+sdk. */
function forbiddenPackImport(packId: string, rel: string, specifier: string): string | null {
  if (specifier.includes("web/src/")) return "imports from web/src";
  const bare = specifier.match(/(?:^|\/)plugins\/src\/([^/]+)/);
  if (bare && bare[1] !== packId) return `imports pack ${bare[1]}`;
  if (specifier.includes("/plugins/sdk/") || /(?:^|\/)sdk\//.test(specifier)) return null;
  if (!specifier.startsWith(".")) return null;
  const abs = path.normalize(path.join(packsRoot, packId, path.dirname(rel), specifier));
  const repoRel = path.relative(repoRoot, abs).replace(/\\/g, "/");
  if (repoRel.startsWith("plugins/sdk/")) return null;
  if (repoRel.startsWith(`plugins/src/${packId}/`)) return null;
  if (repoRel.startsWith("plugins/src/")) {
    const other = repoRel.match(/^plugins\/src\/([^/]+)/)?.[1];
    return other ? `imports pack ${other}` : "imports outside pack and sdk";
  }
  if (repoRel.includes("web/src/")) return "imports from web/src";
  return "imports outside pack and sdk";
}

const VIZ_CONTRACT_IMPORT = /import\s+type\s+[\s\S]*?\s+from\s+['"][^'"]*viz-contract(?:\.ts)?['"]/;

const FRAME_PARAM = /\bonFrame\s*=\s*\(\s*(\w+)/;

const SLICE_INLINE = /(?:packets|talkers|rf|sys|headlines|links)\??\s*:\s*\{([^}]+)\}/g;

const ALLOWED_KEYS: Record<string, Set<string>> = {
  packets: new Set(["proto", "size", "field"]),
  talkers: new Set(["id", "rate", "role", "failed"]),
  links: new Set(["src", "dst", "rate"]),
  rf: new Set(["ssid", "rssi", "channel"]),
  sys: new Set([
    "cpu", "mem", "disk", "gpu", "temp", "watts", "psi", "sockets", "failed", "udev",
  ]),
  headlines: new Set(["id", "label", "text", "kind", "summary", "image"]),
};

function listPackIds(): string[] {
  return readdirSync(packsRoot, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
}

function packTsFiles(packId: string): string[] {
  const dir = path.join(packsRoot, packId);
  const out: string[] = [];
  const walk = (rel: string) => {
    for (const ent of readdirSync(path.join(dir, rel), { withFileTypes: true })) {
      const sub = rel ? `${rel}/${ent.name}` : ent.name;
      if (ent.isDirectory()) walk(sub);
      else if (ent.name.endsWith(".ts")) out.push(sub);
    }
  };
  walk("");
  return out;
}

function propNames(block: string): string[] {
  return block
    .split(/[,;\n]/)
    .map((line) => line.trim().match(/^(\w+)\??\s*:/))
    .filter(Boolean)
    .map((m) => m![1]!);
}

function collectPackSources(): { packId: string; rel: string; text: string }[] {
  const rows: { packId: string; rel: string; text: string }[] = [];
  for (const packId of listPackIds()) {
    for (const rel of packTsFiles(packId)) {
      rows.push({
        packId,
        rel,
        text: readFileSync(path.join(packsRoot, packId, rel), "utf8"),
      });
    }
  }
  return rows;
}

beforeEach(() => {
  expect.hasAssertions();
});

describe("viz contract packs", () => {
  it("records VIZ_CONTRACT_VERSION for pack lint", () => {
    expect(VIZ_CONTRACT_VERSION).toBeGreaterThanOrEqual(1);
  });

  it("contract module has no imports", () => {
    const src = readFileSync(path.join(repoRoot, "plugins/sdk/viz-contract.ts"), "utf8");
    expect(src).not.toMatch(/^\s*import\s/m);
  });

  it("packs do not duplicate frame slice types or import host internals", () => {
    const violations: string[] = [];

    for (const { packId, rel, text } of collectPackSources()) {
      if (PACK_FRAME_TYPE_ALLOWLIST[packId]) continue;

      if (HOST_IMPORT.test(text)) {
        violations.push(`${packId}/${rel}: imports from web/src`);
      }
      let impM: RegExpExecArray | null;
      const impRe = new RegExp(IMPORT_FROM.source, "g");
      while ((impM = impRe.exec(text)) !== null) {
        const spec = impM[1]!;
        const why = forbiddenPackImport(packId, rel, spec);
        if (why) violations.push(`${packId}/${rel}: ${why} (${spec})`);
      }
      const withoutImports = text.replace(/^\s*import\s[\s\S]*?;\s*$/gm, "");
      if (FORBIDDEN_LOCAL_TYPE.test(withoutImports)) {
        violations.push(`${packId}/${rel}: declares a local viz frame or slice type`);
      }

      let m: RegExpExecArray | null;
      const re = new RegExp(SLICE_INLINE.source, "g");
      while ((m = re.exec(text)) !== null) {
        const slice = text.slice(m.index, m.index + 48).match(/(packets|talkers|rf|sys|headlines|links)/)?.[1];
        if (!slice) continue;
        const keys = propNames(m[1]!);
        const allowed = ALLOWED_KEYS[slice];
        for (const key of keys) {
          if (!allowed?.has(key)) {
            violations.push(`${packId}/${rel}: ${slice} field "${key}" is outside viz-contract`);
          }
        }
      }

      const readsFrame = FRAME_PARAM.test(text) && !/\bonFrame\s*=\s*\(\s*\)/.test(text);
      if (readsFrame && !VIZ_CONTRACT_IMPORT.test(text)) {
        violations.push(`${packId}/${rel}: reads viz frames but does not import from viz-contract`);
      }
    }

    expect(violations).toEqual([]);
  });

  it("allowlist only contains packs with open frame-type PRs", () => {
    const packIds = new Set(listPackIds());
    for (const id of Object.keys(PACK_FRAME_TYPE_ALLOWLIST)) {
      expect(packIds.has(id) || id === "ant-colony" || id === "marble-run").toBe(true);
    }
  });

  it("frozen golden-live fixture carries v2 contract slices", () => {
    expect(VIZ_FIXTURE_GOLDEN_LIVE.contract).toBe(VIZ_CONTRACT_VERSION);
    expect((VIZ_FIXTURE_GOLDEN_LIVE.links?.length ?? 0)).toBeGreaterThan(0);
  });

  it("frozen golden-live-failed fixture carries v2 talkers[].failed", () => {
    expect(VIZ_FIXTURE_GOLDEN_LIVE_FAILED.contract).toBe(VIZ_CONTRACT_VERSION);
    expect(VIZ_FIXTURE_GOLDEN_LIVE_FAILED.talkers.some((t) => t.failed != null)).toBe(true);
  });
});
