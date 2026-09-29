#!/usr/bin/env node
/**
 * Offline check for the pick-every-view wall rule (no browser, no backend).
 *
 * Proves that the content-area sample (overlay rects masked) and the carousel image rule score an
 * empty carousel still as blank even when caption text is on it, while lit views stay ok, and that
 * the old five-patch rule alone scored the empty still "ok" (revert proof).
 *
 * Part A (always): synthetic 1280x800 PNGs built in memory.
 * Part B (when the files exist): saved screenshots with hand-measured overlay rects standing in for
 * what qeOverlayRects() returns in the page (header bottom y=111, 1280x800 viewport):
 *   --apod-blank    batch D replay, image hosts blocked, APOD empty under "Showing sample pictures."
 *   --eo-blank      same replay, the Earth Observatory 35s shot the harness scored "ok"
 *   --lit-carousel  a Ready carousel from the 20fa18a7 fresh sweep (Met highlights)
 *   --topology      a Ready non-carousel view from the same sweep
 * Missing files are reported as skipped; --require-evidence makes that a failure.
 *
 * Usage (cwd web/): node scripts/pick-every-view-wall.check.mjs [--apod-blank F] [--eo-blank F]
 *   [--lit-carousel F] [--topology F] [--require-evidence] [--json OUT]
 * Exit 0 when every expectation holds.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { PNG } from "pngjs";
import { fivePatchSample, maskedWallSample, sampleVerdict, scoreWall } from "./pick-every-view-util.mjs";

const args = { apodBlank: "/workspace/zv-clips/batchD/down-site-apod-blank.png", eoBlank: "/tmp/uxpro-pickall/out-679dbf17-downsite/shots/03-carousel_earth-iotd-35s.png", litCarousel: "/workspace/qe-logs/pickall-20fa18a7-fresh/shots/62-carousel_met.png", topology: "/workspace/qe-logs/pickall-20fa18a7-fresh/shots/23-topology.png", requireEvidence: false, json: null };
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  const key = { "--apod-blank": "apodBlank", "--eo-blank": "eoBlank", "--lit-carousel": "litCarousel", "--topology": "topology", "--json": "json" }[a];
  if (key) args[key] = process.argv[++i];
  else if (a === "--require-evidence") args.requireEvidence = true;
  else throw new Error(`unknown argument ${a}`);
}

const W = 1280; const H = 800; const BAR = 111;

function canvas(fill) {
  const png = new PNG({ width: W, height: H });
  for (let i = 0; i < W * H; i++) { png.data[i * 4] = fill[0]; png.data[i * 4 + 1] = fill[1]; png.data[i * 4 + 2] = fill[2]; png.data[i * 4 + 3] = 255; }
  return png;
}
function put(png, x, y, c) { if (x < 0 || y < 0 || x >= W || y >= H) return; const i = (y * W + x) * 4; png.data[i] = c[0]; png.data[i + 1] = c[1]; png.data[i + 2] = c[2]; }
function rect(png, r, c) { for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) put(png, x, y, c); }
/** Text-like glyph rows: 2px strokes on a 7px pitch, broken into "words". */
function textBlock(png, r, c) {
  for (let y = r.y; y < r.y + r.h; y++) {
    if ((y - r.y) % 7 > 2) continue;
    for (let x = r.x; x < r.x + r.w; x++) if ((x * 7 + y * 3) % 11 < 6 && (x >> 5) % 5 !== 4) put(png, x, y, c);
  }
}
function header(png) { rect(png, { x: 0, y: 0, w: W, h: BAR }, [22, 20, 18]); textBlock(png, { x: 20, y: 20, w: 900, h: 70 }, [230, 220, 200]); }

const region = { x: 0, y: BAR, w: W, h: H - BAR };
const feed = { x: 962, y: 120, w: 312, h: 630 };
const fps = { x: 1214, y: 766, w: 62, h: 30 };

function synthetic() {
  // A1: empty carousel still (#07090f) with the sample line + title + body caption and a feed panel.
  const blank = canvas([7, 9, 15]); header(blank);
  const cap = { x: 0, y: 511, w: W, h: H - 511 };
  textBlock(blank, { x: 64, y: 583, w: 744, h: 194 }, [244, 232, 200]);
  rect(blank, feed, [30, 28, 26]); textBlock(blank, { x: 970, y: 130, w: 290, h: 600 }, [200, 200, 210]);
  // A2: lit picture under the same chrome.
  const lit = canvas([7, 9, 15]); header(lit);
  for (let y = BAR; y < H; y++) for (let x = 0; x < W; x++) put(lit, x, y, [(x * 3 + y) % 200 + 30, (y * 2) % 180 + 40, (x + y * 5) % 160 + 50]);
  textBlock(lit, { x: 64, y: 583, w: 744, h: 194 }, [244, 232, 200]);
  rect(lit, feed, [30, 28, 26]);
  // A3: dark graph view: near-black floor with a lit grid and a few nodes (Topology-like).
  const graph = canvas([12, 6, 6]); header(graph);
  for (let y = BAR; y < 745; y++) for (let x = 0; x < W; x++) if (x % 64 < 3 || y % 48 < 3) put(graph, x, y, [200, 60, 40]);
  for (const [cx, cy] of [[300, 300], [640, 420], [800, 250]]) rect(graph, { x: cx - 8, y: cy - 8, w: 16, h: 16 }, [120, 180, 255]);
  rect(graph, feed, [30, 28, 26]);
  const imgBroken = { src: "/api/sources/image?url=https%3A%2F%2Fapod.nasa.gov%2Fx.jpg", complete: true, naturalWidth: 0, errored: "error event" };
  const imgOk = { src: "/api/sources/image?url=https%3A%2F%2Fimages.metmuseum.org%2Fx.jpg", complete: true, naturalWidth: 1600, errored: null };
  return [
    { part: "A", name: "synthetic empty carousel + caption", png: blank, region, masks: [cap, feed, fps], carousel: { image: imgBroken, rect: region }, expect: { old: "ok", score: false } },
    { part: "A", name: "synthetic lit carousel + caption", png: lit, region, masks: [cap, feed, fps], carousel: { image: imgOk, rect: region }, expect: { score: true } },
    { part: "A", name: "synthetic dark graph (non-carousel)", png: graph, region: { x: 0, y: BAR, w: W, h: 634 }, masks: [feed, fps], carousel: null, expect: { score: true } },
  ];
}

function evidence() {
  const out = [];
  const add = (file, row) => {
    if (!file || !existsSync(file)) { out.push({ part: "B", name: row.name, file, skipped: true }); return; }
    out.push({ part: "B", file, png: PNG.sync.read(readFileSync(file)), ...row });
  };
  // Region as pageState computed it in those runs: header bottom 111, right edge at the docked feed
  // (x 968), bottom at the viewport (carousel) or at #foot (Topology). These regions reproduce the
  // five-patch values recorded in the runs' pickall.json exactly, so the "old" column is the old verdict.
  const carRegion = { x: 0, y: BAR, w: 968, h: H - BAR };
  const caption = (top) => ({ x: 0, y: top, w: W, h: H - top, what: ".carousel-caption (4.5rem padding above the first text line)" });
  const broken = (src) => ({ src, complete: true, naturalWidth: 0, errored: "error event" });
  // 679dbf17, image hosts DNS-blocked: <img> src 502 (naturalWidth 0) over the dark still, caption
  // "Showing sample pictures. APOD isn't responding." + sample title/body from y 583.
  add(args.apodBlank, {
    name: "(1) down-site-apod-blank (APOD, hosts blocked)", region: carRegion,
    masks: [caption(511), { x: 664, y: 110, w: 78, h: 22, what: ".label nest-cam" }, { x: 496, y: 232, w: 78, h: 22, what: ".label phone" }],
    carousel: { image: broken("/api/sources/image?url=https%3A%2F%2Fwww.nasa.gov%2F...o.jpg"), rect: carRegion },
    expect: { old: "ok", score: false },
  });
  // Same replay, the 35s shot the harness scored for Earth Observatory (caption masked; the ten
  // node labels over the still deliberately left unmasked).
  add(args.eoBlank, {
    name: "(1b) EO 35s shot (hosts blocked; caption masked, node labels left in)", region: carRegion,
    masks: [caption(511)],
    carousel: { image: broken("/api/sources/image?url=https%3A%2F%2Fassets.science.nasa.gov%2F...jpg"), rect: carRegion },
    expect: { old: "ok", score: false },
  });
  // 20fa18a7 fresh sweep #62, Ready: Met still loaded, caption over the lower third.
  add(args.litCarousel, {
    name: "(2) 62-carousel_met (20fa18a7 fresh, Ready, lit)", region: carRegion,
    masks: [caption(553)],
    carousel: { image: { src: "/api/sources/image?url=https%3A%2F%2Fimages.metmuseum.org%2F...jpg", complete: true, naturalWidth: 1600, errored: null }, rect: carRegion },
    expect: { old: "ok", score: true },
  });
  // 20fa18a7 fresh sweep #23, Ready: Topology, node labels masked.
  add(args.topology, {
    name: "(3) 23-topology (20fa18a7 fresh, Ready, non-carousel)", region: { x: 0, y: BAR, w: 968, h: 634 },
    masks: [{ x: 222, y: 283, w: 96, h: 32, what: ".label cdn" }, { x: 560, y: 320, w: 110, h: 34, what: ".label gateway" }, { x: 725, y: 405, w: 110, h: 34, what: ".label nest-cam" }, { x: 420, y: 290, w: 110, h: 34, what: ".label printer" }],
    carousel: null,
    expect: { old: "ok", score: true },
  });
  return out;
}

const rows = [];
let failed = 0;
for (const c of [...synthetic(), ...evidence()]) {
  if (c.skipped) {
    rows.push({ part: c.part, name: c.name, skipped: true, file: c.file });
    if (args.requireEvidence) failed++;
    continue;
  }
  const five = fivePatchSample(c.png, c.region);
  const unmasked = maskedWallSample(c.png, c.region, []);
  const content = maskedWallSample(c.png, c.region, c.masks);
  const carousel = c.carousel ? { image: c.carousel.image, rect: c.carousel.rect, imgSample: maskedWallSample(c.png, c.carousel.rect, c.masks) } : null;
  const score = scoreWall({ five, content, carousel });
  const oldV = sampleVerdict(five);
  const bad = [];
  if (c.expect.old && oldV !== c.expect.old) bad.push(`old rule ${oldV}, expected ${c.expect.old}`);
  if (score.ok !== c.expect.score) bad.push(`new score ${score.ok ? "ok" : "blank"}, expected ${c.expect.score ? "ok" : "blank"}`);
  if (bad.length) failed++;
  rows.push({
    part: c.part, name: c.name, file: c.file ?? null,
    old: oldV, patches: five.patches.map((p) => `${p.r},${p.g},${p.b}/sd${p.sd}`),
    contentUnmasked: sampleVerdict(unmasked), contentLitUnmasked: unmasked.contentLit,
    content: sampleVerdict(content), contentLit: content.contentLit, varied: content.varied, maskedFraction: content.maskedFraction,
    imgLoaded: score.carousel ? score.carousel.imgLoaded : null, imgArea: carousel ? sampleVerdict(carousel.imgSample) : null,
    newScore: score.ok ? "ok" : `blank (${score.what}; by ${score.by})`, why: score.carousel?.why || null,
    pass: !bad.length, problems: bad,
  });
}

const pad = (x, n) => String(x ?? "–").padEnd(n);
console.log(`${pad("case", 88)} ${pad("old", 8)} ${pad("unmasked", 9)} ${pad("content", 8)} ${pad("lit", 7)} ${pad("masked", 7)} ${pad("imgLoaded", 10)} ${pad("imgArea", 8)} new score`);
for (const r of rows) {
  if (r.skipped) { console.log(`${pad(r.name, 88)} skipped (missing ${r.file})`); continue; }
  console.log(`${pad(r.name, 88)} ${pad(r.old, 8)} ${pad(r.contentUnmasked, 9)} ${pad(r.content, 8)} ${pad(r.contentLit, 7)} ${pad(r.maskedFraction, 7)} ${pad(r.imgLoaded, 10)} ${pad(r.imgArea, 8)} ${r.newScore}${r.pass ? "" : `   <-- FAIL: ${r.problems.join("; ")}`}`);
}
if (args.json) writeFileSync(args.json, JSON.stringify(rows, null, 1));
console.log(failed ? `\nFAIL: ${failed} case(s)` : "\nPASS: every case as expected (old rule ok on the empty still; new rule blank; lit views ok)");
process.exit(failed ? 1 : 0);
