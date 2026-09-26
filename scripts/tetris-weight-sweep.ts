/**
 * One-off landing-weight grid (not vitest / not CI). Results table: PR #47 body.
 * Imports the same planner + battery helpers as tests — keep in sync.
 */
import {
  makeScoreBoardFromLandingWeights,
  PRODUCTION_LANDING_WEIGHTS,
  type LandingWeightPair,
} from "../web/src/arcade/tetris-engine.ts";
import { runThreeBatteries } from "../web/src/arcade/tetris-batteries.ts";
import { assertSweepSeed, tuningSeeds } from "../web/src/arcade/tetris-seed-guard.ts";

const AGG_GRID = [-3.5, -4.0, -4.25, -4.5, -4.75];
const PIECE_GRID = [-0.2, -0.3, -0.35, -0.4, -0.45, -0.5, -0.6];

function fmtPair(p: LandingWeightPair): string {
  return `${p.aggregateLanding}/${p.pieceLanding}`;
}

type Row = {
  pair: LandingWeightPair;
  survival: string;
  tDrill: string;
  sz: string;
  pass: boolean;
  fails: string;
};

const seeds = tuningSeeds();
for (const s of seeds) assertSweepSeed(s);

const rows: Row[] = [];

for (const aggregateLanding of AGG_GRID) {
  for (const pieceLanding of PIECE_GRID) {
    const pair: LandingWeightPair = { aggregateLanding, pieceLanding };
    const r = runThreeBatteries(seeds, pair);
    const fails =
      r.tDrillFails.length > 0
        ? r.tDrillFails.map((f) => `${f.seed}:${f.new}<${f.old}-1`).join(",")
        : "";
    rows.push({
      pair,
      survival: `${r.survivalCount}/${seeds.length}`,
      tDrill: r.tDrillPass ? "ok" : `fail(${r.tDrillFails.length})`,
      sz: r.szPass ? `ok(${r.szLines})` : `fail(${r.szLines},top=${r.szToppedOut})`,
      pass: r.survivalPass && r.tDrillPass && r.szPass,
      fails,
    });
  }
}

const prod = runThreeBatteries(seeds, PRODUCTION_LANDING_WEIGHTS);
console.log("Tuning seeds 0–19 only (held-out 20–59 excluded from sweep)\n");
console.log(
  `Production ${fmtPair(PRODUCTION_LANDING_WEIGHTS)}: survival ${prod.survivalCount}/20, tDrill ${prod.tDrillPass ? "ok" : "fail"}, sz ${prod.szPass ? "ok" : "fail"}`,
);
if (!prod.tDrillPass) {
  console.log("Production T-drill fails:", prod.tDrillFails.map((f) => f.seed).join(","));
}

console.log("\n| aggregate | piece | survival | T-drill | S/Z | pass |");
console.log("|-----------|-------|----------|---------|-----|------|");
for (const row of rows) {
  console.log(
    `| ${row.pair.aggregateLanding} | ${row.pair.pieceLanding} | ${row.survival} | ${row.tDrill} | ${row.sz} | ${row.pass ? "YES" : ""} |`,
  );
}

const winners = rows.filter((r) => r.pass);
console.log(`\nPassing sets on tuning seeds: ${winners.length}`);
for (const w of winners) {
  console.log(`  ${fmtPair(w.pair)}`);
}
