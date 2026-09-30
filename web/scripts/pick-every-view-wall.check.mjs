#!/usr/bin/env node
/**
 * Offline check for the pick-every-view wall rule (no browser, no backend).
 *
 * v5 rule (scoreWall): with >= 40% of the tile left after masking overlays the content area decides;
 * the five-patch sample only keeps a black the area cannot clear (under 1% of it lit); 5-40% left:
 * either sample fails it; under 5%: area not judged, five-patch decides, harness warning. The carousel
 * image rule is unchanged: an empty carousel still is blank even with caption text on it.
 *
 * Part A (always): synthetic 1280x800 PNGs built in memory (empty still + caption, lit carousel, dark
 *   graph, dark ground with lit spots between the patches, flat coloured floor, dim structure with
 *   nothing lit, low-coverage bands).
 * Part B (when the files exist): saved screenshots with hand-measured overlay rects standing in for
 *   what qeOverlayRects() returns in the page (header bottom y=111, 1280x800 viewport):
 *   --apod-blank    batch D replay, image hosts blocked, APOD empty under "Showing sample pictures."
 *   --eo-blank      same replay, the Earth Observatory 35s shot the harness scored "ok"
 *   --lit-carousel  a Ready carousel from the 20fa18a7 fresh sweep (Met highlights)
 *   --topology      a Ready non-carousel view from the same sweep
 * Part C (when the files exist): UX Pro's batch C early-6b172413-*.png + .json (--batch-c DIR). Scored
 *   twice: from the samples the json recorded (overlays masked in the page) and re-sampled from the
 *   PNG over the recorded region (unmasked; the json has the rect count, not the rects).
 * Washed-out (#178): synthetic rows A10-A12 (Blob-like bright edge-free wall -> washed-out, Roto-like
 *   drawn floor at median ~113 -> ok, flat black -> still black) and, when the files exist, Part E:
 *   UX Pro's bbf8b77d headed shots (--batch-c-bbf8 DIR): all 7 Blob Mesh in-app shots washed-out;
 *   Ant, Roto and Cypher (open-full) ok. Regions from the shot json, masks from <stem>-mask.json.
 *   Revert proof: --util <util with the washed-out line removed, or the util at cc2d4254> turns
 *   exactly the Blob rows red.
 *   Carousel exemption: A13 (a smooth sky photo in a loaded carousel) and Part F (the fd97fbdb
 *   v5-fresh 52-carousel_apod shot, --apod-sky FILE) stay ok; with the exemption line removed from
 *   the util both go red as washed-out.
 * Part D (--rescore DIR, repeatable): every view shot of a saved sweep (pickall.json + shots/). The
 *   region is the one that reproduces the five-patch values recorded in pickall.json; no overlay rects
 *   were recorded, so the content area is unmasked. The row flow is simulated: first shot, then the
 *   35s shot when the rule holds the view.
 * --baseline-util FILE (e.g. the util at 44200de8) adds the before column and the changed-rows list.
 * --util FILE scores with another util (the red run: --util <util at 44200de8>).
 * Missing files are reported as skipped; --require-evidence makes that a failure.
 *
 * Usage (cwd web/): node scripts/pick-every-view-wall.check.mjs [--util F] [--baseline-util F]
 *   [--apod-blank F] [--eo-blank F] [--lit-carousel F] [--topology F] [--batch-c DIR]
 *   [--rescore DIR ...] [--require-evidence] [--json OUT]
 * Exit 0 when every expectation holds.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { PNG } from "pngjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const args = {
  util: path.join(here, "pick-every-view-util.mjs"), baselineUtil: null,
  apodBlank: "/workspace/zv-clips/batchD/down-site-apod-blank.png", eoBlank: "/tmp/uxpro-pickall/out-679dbf17-downsite/shots/03-carousel_earth-iotd-35s.png",
  litCarousel: "/workspace/qe-logs/pickall-20fa18a7-fresh/shots/62-carousel_met.png", topology: "/workspace/qe-logs/pickall-20fa18a7-fresh/shots/23-topology.png",
  batchC: "/workspace/zv-clips/batchC", batchCbbf8: "/workspace/zv-clips/batchC/bbf8b77d", apodSky: "/workspace/zv-clips/batchC/fd97fbdb/v5-fresh/shots/52-carousel_apod.png", rescore: [], requireEvidence: false, json: null,
};
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  const key = { "--util": "util", "--baseline-util": "baselineUtil", "--apod-blank": "apodBlank", "--eo-blank": "eoBlank", "--lit-carousel": "litCarousel", "--topology": "topology", "--batch-c": "batchC", "--batch-c-bbf8": "batchCbbf8", "--apod-sky": "apodSky", "--json": "json" }[a];
  if (key) args[key] = process.argv[++i];
  else if (a === "--rescore") args.rescore.push(process.argv[++i]);
  else if (a === "--require-evidence") args.requireEvidence = true;
  else throw new Error(`unknown argument ${a}`);
}
const U = await import(pathToFileURL(path.resolve(args.util)).href);
const B = args.baselineUtil ? await import(pathToFileURL(path.resolve(args.baselineUtil)).href) : null;
const { fivePatchSample, maskedWallSample, sampleVerdict, scoreWall } = U;
const isV5 = typeof U.LIT_TO_CLEAR_BLACK === "number";

const W = 1280; const H = 800; const BAR = 111;

function canvas(fill) {
  const png = new PNG({ width: W, height: H });
  for (let i = 0; i < W * H; i++) { png.data[i * 4] = fill[0]; png.data[i * 4 + 1] = fill[1]; png.data[i * 4 + 2] = fill[2]; png.data[i * 4 + 3] = 255; }
  return png;
}
function put(png, x, y, c) { if (x < 0 || y < 0 || x >= W || y >= H) return; const i = (y * W + x) * 4; png.data[i] = c[0]; png.data[i + 1] = c[1]; png.data[i + 2] = c[2]; }
function rect(png, r, c) { for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) put(png, x, y, c); }
function disc(png, cx, cy, rad, c) { for (let y = cy - rad; y <= cy + rad; y++) for (let x = cx - rad; x <= cx + rad; x++) if ((x - cx) ** 2 + (y - cy) ** 2 <= rad * rad) put(png, x, y, c); }
/** Text-like glyph rows: 2px strokes on a 7px pitch, broken into "words". */
function textBlock(png, r, c) {
  for (let y = r.y; y < r.y + r.h; y++) {
    if ((y - r.y) % 7 > 2) continue;
    for (let x = r.x; x < r.x + r.w; x++) if ((x * 7 + y * 3) % 11 < 6 && (x >> 5) % 5 !== 4) put(png, x, y, c);
  }
}
function header(png) { rect(png, { x: 0, y: 0, w: W, h: BAR }, [22, 20, 18]); textBlock(png, { x: 20, y: 20, w: 900, h: 70 }, [230, 220, 200]); }
/** Masks that leave only `keep` of `reg` (a band across the top of it). */
function maskAllBut(reg, keep) {
  const hKeep = Math.round(reg.h * keep);
  return [{ x: reg.x, y: reg.y + hKeep, w: reg.w, h: reg.h - hKeep, what: "big overlay" }];
}

const region = { x: 0, y: BAR, w: W, h: H - BAR };
const tile = { x: 0, y: BAR, w: 968, h: 634 }; // docked feed, #foot: patch squares at x 230/472/714, y 258/416/575 (+24)
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
  // A4: dark ground with lit spots (Graph Cloth): 6px spots on a 40px pitch at x%40 20..25,
  // y%40 5..10, so all five 24px patches land on the dark ground between them.
  const spots = canvas([10, 12, 14]); header(spots); rect(spots, feed, [30, 28, 26]);
  for (let y = BAR; y < 745; y++) for (let x = 0; x < 962; x++) if (x % 40 >= 20 && x % 40 < 26 && y % 40 >= 5 && y % 40 < 11) put(spots, x, y, [170, 190, 120]);
  // A5: flat coloured floor (LAN heat): one orange all over the patch points, a band of heat rings
  // (y 450..565, between the patch rows) and two nodes.
  const floor = canvas([150, 62, 30]); header(floor); rect(floor, feed, [30, 28, 26]);
  for (let y = 450; y < 565; y++) for (let x = 100; x < 868; x++) if (x % 8 < 4 && y % 8 < 4) put(floor, x, y, [230, 120, 60]);
  for (const [cx, cy] of [[360, 330], [600, 330]]) rect(floor, { x: cx - 10, y: cy - 10, w: 20, h: 20 }, [240, 200, 150]);
  // A6: dim structure with nothing lit (Ant Colony at 0.7): lum ~15 ground, lum ~32 blobs away from
  // the patch points; no pixel reaches lum 40.
  const dim = canvas([18, 14, 14]); header(dim); rect(dim, feed, [30, 28, 26]);
  for (const [cx, cy] of [[120, 180], [360, 340], [600, 180], [850, 340], [360, 680], [850, 680], [120, 500], [600, 500]]) disc(dim, cx, cy, 34, [60, 25, 22]);
  // A10: Blob-like washed-out wall (Blob Mesh at bbf8b77d: near-uniform cyan, lumas 109-204, lit
  // 0.90-0.97 against its own background, no blob edge): a cyan sky with soft blobs, every slope
  // well under 2 lum/px so no Sobel edge.
  const wall = canvas([18, 14, 14]); header(wall); rect(wall, feed, [30, 28, 26]);
  const blobs = [[300, 330, 150, 0.55], [640, 520, 170, 0.45], [800, 250, 130, 0.35], [150, 620, 140, 0.3]];
  for (let y = BAR; y < 745; y++) for (let x = 0; x < 962; x++) {
    let v = 0.62 + 0.12 * (x / 962);
    for (const [cx, cy, s, a] of blobs) v += a * Math.exp(-((x - cx) ** 2 + (y - cy) ** 2) / (2 * s * s));
    put(wall, x, y, [Math.round(Math.min(255, 70 * v)), Math.round(Math.min(255, 150 * v)), Math.round(Math.min(255, 165 * v))]);
  }
  // A11: Roto-like drawn floor (Roto Proto at bbf8b77d: median 112-114, reads correctly): a grey
  // checker with dark grid lines, lit edge to edge but full of edges.
  const roto = canvas([18, 14, 14]); header(roto); rect(roto, feed, [30, 28, 26]);
  for (let y = BAR; y < 745; y++) for (let x = 0; x < 962; x++) {
    const c = ((x >> 5) + (y >> 5)) & 1 ? 122 : 104;
    put(roto, x, y, x % 32 < 2 || y % 32 < 2 ? [70, 70, 74] : [c, c + 2, c + 6]);
  }
  // A12: flat black frame (Backrooms at bbf8b77d, a flat 17): black, never washed-out.
  const black = canvas([15, 15, 15]); header(black); rect(black, feed, [30, 28, 26]);
  // A13: carousel-like smooth sky photo (the APOD Analemma still): a blue twilight gradient with a
  // few small sun dots, caption band masked, image loaded. As edge-free and lit as the Blob wall.
  const sky = canvas([7, 9, 15]); header(sky); rect(sky, feed, [30, 28, 26]);
  for (let y = BAR; y < H; y++) for (let x = 0; x < 962; x++) {
    const t = (y - BAR) / (H - BAR); const u = x / 962;
    put(sky, x, y, [Math.round(40 + 55 * t + 10 * u), Math.round(78 + 55 * t + 8 * u), Math.round(150 + 45 * t)]);
  }
  for (let k = 0; k < 18; k++) disc(sky, 480 + Math.round(60 * Math.sin(k / 3)), 130 + k * 20, 2, [255, 250, 235]);
  const imgBroken = { src: "/api/sources/image?url=https%3A%2F%2Fapod.nasa.gov%2Fx.jpg", complete: true, naturalWidth: 0, errored: "error event" };
  const imgOk = { src: "/api/sources/image?url=https%3A%2F%2Fimages.metmuseum.org%2Fx.jpg", complete: true, naturalWidth: 1600, errored: null };
  const band = (keep) => [...maskAllBut(tile, keep), fps];
  return [
    { part: "A", name: "A1 synthetic empty carousel still + caption (stays blank)", png: blank, region, masks: [cap, feed, fps], carousel: { image: imgBroken, rect: region }, expect: { old: "ok", score: false } },
    { part: "A", name: "A2 synthetic lit carousel + caption", png: lit, region, masks: [cap, feed, fps], carousel: { image: imgOk, rect: region }, expect: { score: true } },
    { part: "A", name: "A3 synthetic dark graph (non-carousel)", png: graph, region: { x: 0, y: BAR, w: W, h: 634 }, masks: [feed, fps], carousel: null, expect: { score: true } },
    { part: "A", name: "A4 dark ground, lit spots between the patches (Graph Cloth)", png: spots, region: tile, masks: [fps], carousel: null, expect: { old: "black", score: true, decidedBy: "area" } },
    { part: "A", name: "A5 flat coloured floor (LAN heat)", png: floor, region: tile, masks: [fps], carousel: null, expect: { old: "uniform", score: true, decidedBy: "area" } },
    { part: "A", name: "A6 dim structure, nothing at lum >= 40 (Ant Colony 0.7)", png: dim, region: tile, masks: [fps], carousel: null, expect: { old: "black", score: false } },
    { part: "A", name: "A7 lit spots, 20% of the tile left (patch + area)", png: spots, region: tile, masks: band(0.2), carousel: null, expect: { old: "black", score: false, decidedBy: "patch+area", warn: /left after masking/ } },
    { part: "A", name: "A8 flat floor, 3% left (area not judged, five-patch decides)", png: floor, region: tile, masks: band(0.03), carousel: null, expect: { old: "uniform", score: false, decidedBy: "patch", warn: /not judged/ } },
    { part: "A", name: "A9 lit picture, 3% left (area not judged, five-patch ok)", png: lit, region: tile, masks: band(0.03), carousel: null, expect: { old: "ok", score: true, decidedBy: "patch", warn: /not judged/ } },
    { part: "A", name: "A10 Blob-like bright edge-free wall (#178: washed-out)", png: wall, region: tile, masks: [fps], carousel: null, mode: { lean: true, k: 0.9988 }, expect: { old: "ok", score: false, what: "washed-out", decidedBy: "area", washedOut: true } },
    { part: "A", name: "A11 Roto-like drawn floor, median ~113 (#178: ok)", png: roto, region: tile, masks: [fps], carousel: null, mode: { lean: true, k: 0.9999 }, expect: { old: "ok", score: true, washedOut: false } },
    { part: "A", name: "A12 flat black frame (#178: stays black)", png: black, region: tile, masks: [fps], carousel: null, expect: { old: "black", score: false, what: "black" } },
    { part: "A", name: "A13 carousel sky photo, loaded (#178: carousel exempt, ok)", png: sky, region, masks: [cap, feed, fps], carousel: { image: imgOk, rect: region }, expect: { old: "ok", score: true, exempt: "carousel" } },
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

/**
 * UX Pro batch C (6b172413). Expected wall score per shot: Graph Cloth and LAN heat are plainly drawn
 * (false black / false uniform); Blob Mesh and Ant Colony are real Fails confirmed by eye.
 */
const BATCH_C_EXPECT = [
  [/graph-cloth/, true, "Graph Cloth: lit nodes/edges on dark ground between the grid lines (false black)"],
  [/lan-heat/, true, "LAN heat: flat orange floor, drawn rings and nodes (false uniform)"],
  [/blob-mesh/, false, "Blob Mesh: real Fail by eye (dim floor, no blobs)"],
  [/ant-colony/, false, "Ant Colony 0.7: real Fail by eye (nothing at lum >= 40)"],
  [/roto-proto/, true, "Roto Proto: drawn checker floor (ok before and after)"],
];
function batchC() {
  const out = [];
  if (!args.batchC || !existsSync(args.batchC)) return [{ part: "C", name: "batch C", file: args.batchC, skipped: true }];
  for (const f of readdirSync(args.batchC).filter((x) => /^early-6b172413-.*\.json$/.test(x)).sort()) {
    const j = JSON.parse(readFileSync(path.join(args.batchC, f), "utf8"));
    for (const s of [j.shot, j.thenShot].filter(Boolean)) {
      const base = path.basename(s.file);
      const file = path.join(args.batchC, base);
      const exp = BATCH_C_EXPECT.find(([re]) => re.test(base));
      if (!exp) continue;
      const reg = s.state?.region;
      out.push({ part: "C", kind: "recorded", name: `${base} (recorded samples, ${s.content?.masks ?? "?"} rects masked)`, file, five: s.five, content: s.content, expect: { score: exp[1] }, why: exp[2] });
      if (existsSync(file) && reg) out.push({ part: "C", kind: "resampled", name: `${base} (re-sampled, unmasked)`, file, png: PNG.sync.read(readFileSync(file)), region: reg, masks: [], carousel: null, expect: { score: exp[1] }, why: exp[2] });
    }
  }
  return out;
}

/**
 * UX Pro batch C at bbf8b77d (#178). Blob Mesh in-app shots (header NET Blob Mesh, 7) are the wall
 * UX Pro judged by eye: washed-out. Ant Colony, Roto Proto and Cypher CIC open-full read correctly: ok.
 * Region = the shot json's state.region; masks = <stem>-mask.json rects where recorded; lean/tuneK
 * from the shot json (all lean on, tuneK 0.64-1.0).
 */
const BBF8_EXPECT = [
  [/^blob-mesh-(fresh|shipped)-(35s|60s|pitch15-35s)\.png$|^ant-after-blob-(fresh|shipped)-blob-40s\.png$/, false, "washed-out", "Blob Mesh: near-uniform cyan wall by eye (UX Pro), lit 0.90-0.97, no blob edge"],
  [/^ant-colony-(fresh|shipped)-(35|60|90)s\.png$|^ant-after-blob-(fresh|shipped)-(35|60)s\.png$/, true, null, "Ant Colony: soil with tunnels, lit40 about 56%"],
  [/^roto-proto-/, true, null, "Roto Proto: drawn checker floor, median 112-114, reads correctly"],
  [/^cypher-cic-openfull-/, true, null, "Cypher CIC single (open-full): drawn, not black"],
];
function batchCbbf8() {
  const D = args.batchCbbf8;
  if (!D || !existsSync(D)) return [{ part: "E", name: "batch C bbf8b77d", file: D, skipped: true }];
  const reg = {}; const lean = {};
  for (const j of readdirSync(D).filter((f) => f.endsWith(".json") && !f.endsWith("-mask.json"))) {
    let d; try { d = JSON.parse(readFileSync(path.join(D, j), "utf8")); } catch { continue; }
    const walk = (x) => { if (!x || typeof x !== "object") return; if (typeof x.file === "string" && x.file.endsWith(".png")) { const b = path.basename(x.file); if (x.state?.region) reg[b] ??= x.state.region; if (x.lean) lean[b] ??= x.lean; } for (const v of Object.values(x)) walk(v); };
    walk(d);
  }
  const out = [];
  for (const f of readdirSync(D).filter((x) => x.endsWith(".png")).sort()) {
    const exp = BBF8_EXPECT.find(([re]) => re.test(f));
    if (!exp) continue;
    const mf = path.join(D, f.replace(/\.png$/, "-mask.json"));
    const mj = existsSync(mf) ? JSON.parse(readFileSync(mf, "utf8")) : null;
    const region = reg[f] ?? mj?.region ?? { x: 0, y: BAR, w: 968, h: 660 };
    out.push({ part: "E", name: `${f} (bbf8b77d${mj ? `, ${mj.rects?.length ?? 0} rects masked` : ", unmasked"})`, file: path.join(D, f), png: PNG.sync.read(readFileSync(path.join(D, f))), region, masks: mj?.rects ?? [], carousel: null, mode: lean[f] ?? null, expect: { score: exp[1], ...(exp[2] ? { what: exp[2] } : {}) }, why: exp[3] });
  }
  return out;
}

/** fd97fbdb v5-fresh row 52 (carousel APOD, Ready): a real smooth sky photo; region and the 7 overlay rects as the sweep recorded them. */
function apodSky() {
  const f = args.apodSky;
  if (!f || !existsSync(f)) return [{ part: "F", name: "52-carousel_apod (fd97fbdb v5-fresh)", file: f, skipped: true }];
  let region = { x: 0, y: BAR, w: 968, h: 689 }; let masks = []; let id = "plugin:carousel:apod";
  const jf = path.join(path.dirname(path.dirname(f)), "pickall.json");
  if (existsSync(jf)) {
    const v = JSON.parse(readFileSync(jf, "utf8")).views.find((x) => x.screenshot && path.basename(x.screenshot) === path.basename(f));
    if (v) { region = v.region ?? region; masks = v.overlayRects?.rects ?? []; id = v.id ?? id; }
  }
  return [{ part: "F", name: `52-carousel_apod (fd97fbdb v5-fresh, Ready, ${masks.length} rects masked; carousel exempt)`, file: f, png: PNG.sync.read(readFileSync(f)), region, masks, carousel: null, viewId: id, expect: { score: true, exempt: "carousel" }, why: "APOD Analemma still: smooth twilight sky photo that reads correctly" }];
}

function score(c, S) {
  const five = c.five ?? fivePatchSample(c.png, c.region);
  const content = c.content ?? maskedWallSample(c.png, c.region, c.masks);
  const carousel = c.carousel ? { image: c.carousel.image, rect: c.carousel.rect, imgSample: maskedWallSample(c.png, c.carousel.rect, c.masks) } : null;
  return { five, content, carousel, sc: S.scoreWall({ five, content, carousel, mode: c.mode ?? null, viewId: c.viewId ?? null }) };
}
const verdictOf = (sc) => (sc.ok ? "ok" : `${sc.what} (${sc.by})`);

const rows = [];
let failed = 0;
for (const c of [...synthetic(), ...evidence(), ...batchC(), ...batchCbbf8(), ...apodSky()]) {
  if (c.skipped) {
    rows.push({ part: c.part, name: c.name, skipped: true, file: c.file });
    if (args.requireEvidence) failed++;
    continue;
  }
  const { five, content, sc } = score(c, U);
  const before = B ? score(c, B).sc : null;
  const oldV = sampleVerdict(five);
  const bad = [];
  if (c.expect.old && oldV !== c.expect.old) bad.push(`five-patch ${oldV}, expected ${c.expect.old}`);
  if (sc.ok !== c.expect.score) bad.push(`score ${sc.ok ? "ok" : "fail"}, expected ${c.expect.score ? "ok" : "fail"}`);
  if (c.expect.decidedBy && isV5 && sc.decidedBy !== c.expect.decidedBy) bad.push(`decided by ${sc.decidedBy}, expected ${c.expect.decidedBy}`);
  if (c.expect.what !== undefined && !sc.ok && (sc.what ?? null) !== c.expect.what) bad.push(`verdict ${sc.what}, expected ${c.expect.what}`);
  if (c.expect.what !== undefined && sc.ok && c.expect.score === false) bad.push(`expected ${c.expect.what}${sc.washedOut?.why ? ` (${sc.washedOut.why})` : sc.washedOut === undefined ? " (this util has no washed-out verdict)" : ""}`);
  if (c.expect.exempt && sc.washedOut?.exempt !== c.expect.exempt) bad.push(`washed-out exemption ${sc.washedOut?.exempt ?? "none"}, expected ${c.expect.exempt}${sc.washedOut?.why ? ` (${sc.washedOut.why})` : ""}`);
  if (c.expect.washedOut !== undefined && (sc.washedOut?.flag ?? null) !== c.expect.washedOut) bad.push(`washed-out reading ${sc.washedOut?.flag ?? "absent"}, expected ${c.expect.washedOut}`);
  if (c.expect.warn && !sc.warnings.some((w) => c.expect.warn.test(w))) bad.push(`no harness warning matching ${c.expect.warn}`);
  if (bad.length) failed++;
  rows.push({
    part: c.part, name: c.name, file: c.file ?? null, why: c.why ?? null,
    patch: oldV, patchLums: five.patches ? five.patches.map((p) => Math.round(p.lum)).join("/") : (five.lums ?? []).join("/"),
    area: sampleVerdict(content), contentLit: content.contentLit, varied: content.varied, flatCells: content.flatCells, medianLum: content.medianLum, maskedFraction: content.maskedFraction,
    before: before ? verdictOf(before) : null, after: verdictOf(sc), decidedBy: sc.decidedBy ?? null, overruled: sc.overruled ?? null, warnings: sc.warnings,
    carouselWhy: sc.carousel?.why || null, litVsBg: content.litVsBg ?? null, edge16: content.edge16 ?? null, mode: sc.mode?.label ?? null, washedOut: sc.washedOut ?? null,
    pass: !bad.length, problems: bad,
  });
}

// ---- Part D: saved sweeps ------------------------------------------------------------------------
const REGION_CANDIDATES = [];
for (const w of [968, 1280]) for (const h of [634, 660, 689]) REGION_CANDIDATES.push({ x: 0, y: BAR, w, h });
const patchKey = (five) => five.patches.map((p) => `${p.r},${p.g},${p.b}/sd${p.sd}`).join(" ");
/** Views UX Pro / QE listed as false black / false uniform: allowed (and in the fresh sweep required) to go ok. */
const LISTED_FALSE = new Set(["plugin:cgroups", "plugin:udev", "plugin:disk", "plugin:lan-heat", "plugin:graph-fabric"]);
/**
 * Per sweep: rows that must end ok under the rule. graph-fabric at 20fa18a7 is not in it: its shots
 * show sky + grid floor with no nodes or edges (like Blob Mesh), and its only lit content-area
 * pixels are the node labels, which a live run masks; the lit rule keeps it black.
 */
const MUST_GO_OK = { "pickall-20fa18a7-fresh": ["plugin:cgroups", "plugin:disk", "plugin:lan-heat"] };
/**
 * Listed views the rule does not clear, reported as OPEN (not a check failure):
 *   udev at 20fa18a7 fresh: the 35s shot the row is scored on is area-black by the area rule itself
 *     (0.91% lit, 0.96% varied, cut-offs 1%): four small nodes on a dark floor. Not loosened.
 *   graph-fabric at 20fa18a7: sky + grid floor, no nodes or edges; 0.2% lit, all of it node labels.
 */
const KNOWN_OPEN = {
  "pickall-20fa18a7-fresh plugin:udev": "listed false black, still black: the 35s shot is area-black (lit < 1%, varied < 1%); area rule not loosened",
  "pickall-20fa18a7-fresh plugin:graph-fabric": "listed false black, still black: area ok only on dim structure, < 1% lit (the node labels); kept black like Blob Mesh / Ant Colony",
};
/**
 * Other fail -> ok rows, each checked by eye on the shot the row is scored on (plainly drawn; the
 * five patches landed on a flat floor or dark ground). Same class as the listed views.
 */
const REVIEWED_DRAWN = {
  "pickall-20fa18a7-shipped plugin:metro-lines": "42-metro-lines-35s: pale floor, lit lines and stations (patches on the flat floor)",
  "pickall-20fa18a7-shipped plugin:helix": "59-helix-35s: nodes and rungs on dark navy",
  "pickall-20fa18a7-shipped plugin:orbits": "65-orbits-35s: sun, orbits and satellites on near-black",
  "pickall-20fa18a7-fresh-noconsent plugin:helix": "59-helix-35s: nodes and rungs on dark navy",
  "pickall-20fa18a7-fresh-noconsent plugin:orbits": "65-orbits-35s: sun, orbits and satellites",
  "pickall-20fa18a7-fresh-noconsent plugin:pacman": "66-pacman-35s: 3D maze, ghosts, ticker words",
  "pickall-20fa18a7-fresh-noconsent plugin:air-ssid": "02-air-ssid-35s: floor grid, access points and a flow line",
  "pickall-20fa18a7-noconsent-attempt1 plugin:air-bt": "01-air-bt-35s: devices, labels and lines on the floor",
  "pickall-20fa18a7-noconsent-attempt1 plugin:helix": "59-helix-35s: nodes and rungs on dark navy",
  "pickall-20fa18a7-noconsent-attempt1 plugin:orbits": "65-orbits-35s: sun, orbits and satellites",
  "pickall-20fa18a7-shipped-attempt1 plugin:air-ssid": "02-air-ssid-35s: floor grid, access points and a flow line",
};
/** Parts of a recorded row reason that are not the wall verdict: the row fails on those anyway. */
function otherFailures(r) {
  if (!r.reason || r.state === "Ready") return [];
  return r.reason.split("; ").filter((x) => !/^wall (black|white|uniform)\b/.test(x) && !/^was (FAIL|Ready|Needs|Couldn)/.test(x));
}
const rowsD = [];
const changed = [];
function rowFlow(S, first, second, id) {
  // Harness flow: a five-patch black/uniform, a flat score or Blob Mesh holds the view to 35s and the
  // 35s shot is scored instead of the first one (same trigger in v4 and v5).
  const held = (s) => id === "plugin:blob-mesh" || (s.sc.ok === false && s.sc.what !== "white") || s.five.black || s.five.uniform;
  const a = first;
  if (held(a) && second) return { shot: "35s", s: second };
  return { shot: held(a) ? "first (no 35s shot saved)" : "first", s: a };
}
for (const dir of args.rescore) {
  const tag = path.basename(dir);
  const jf = path.join(dir, "pickall.json");
  if (!existsSync(jf)) { rows.push({ part: "D", name: tag, skipped: true, file: jf }); if (args.requireEvidence) failed++; continue; }
  const res = JSON.parse(readFileSync(jf, "utf8"));
  const files = readdirSync(path.join(dir, "shots"));
  for (const r of res.views) {
    const nn = `${String(r.n).padStart(2, "0")}-`;
    const shots = files.filter((f) => f.startsWith(nn) && f.endsWith(".png")).sort((p, q) => p.length - q.length);
    const firstF = shots.find((f) => !/-35s\.png$/.test(f)); const secondF = shots.find((f) => /-35s\.png$/.test(f));
    if (!firstF) continue;
    const pngs = Object.fromEntries(shots.map((f) => [f, PNG.sync.read(readFileSync(path.join(dir, "shots", f)))]));
    let region = null; let how = "default";
    if (r.wall?.patches) {
      const want = r.wall.patches.join(" ");
      for (const f of [secondF, firstF].filter(Boolean)) { for (const c of REGION_CANDIDATES) if (patchKey(fivePatchSample(pngs[f], c)) === want) { region = c; how = `exact on ${f.endsWith("-35s.png") ? "35s" : "first"}`; break; } if (region) break; }
      if (!region) {
        const lum = (s) => s.split(" ").map((x) => x.split("/")[0].split(",").map(Number));
        const wl = lum(want); let best = Infinity;
        for (const c of REGION_CANDIDATES) { const got = fivePatchSample(pngs[firstF], c).patches.map((p) => [p.r, p.g, p.b]); const d = got.reduce((t, v, k) => t + Math.abs(v[0] - wl[k][0]) + Math.abs(v[1] - wl[k][1]) + Math.abs(v[2] - wl[k][2]), 0); if (d < best) { best = d; region = c; } }
        how = `nearest (patch diff ${best})`;
      }
    }
    region ??= { x: 0, y: BAR, w: 968, h: 634 };
    const sample = (f, S) => { const five = fivePatchSample(pngs[f], region); const content = maskedWallSample(pngs[f], region, []); return { f, five, content, sc: S.scoreWall({ five, content, carousel: null }) }; };
    const after = rowFlow(U, sample(firstF, U), secondF ? sample(secondF, U) : null, r.id);
    const before = B ? rowFlow(B, sample(firstF, B), secondF ? sample(secondF, B) : null, r.id) : null;
    const d = { part: "D", sweep: tag, id: r.id, state: r.state, region: `${region.w}x${region.h} ${how}`, shotAfter: `${after.s.f} (${after.shot})`, after: verdictOf(after.s.sc), afterOk: after.s.sc.ok, patch: sampleVerdict(after.s.five), area: sampleVerdict(after.s.content), contentLit: after.s.content.contentLit, varied: after.s.content.varied, note: after.s.sc.note ?? null };
    if (before) Object.assign(d, { shotBefore: `${before.s.f} (${before.shot})`, before: verdictOf(before.s.sc), beforeOk: before.s.sc.ok });
    const bad = [];
    const key = `${tag} ${r.id}`;
    d.otherFailures = otherFailures(r);
    if ((MUST_GO_OK[tag] ?? []).includes(r.id) && !d.afterOk) bad.push(`listed false ${d.patch}: expected ok, got ${d.after}`);
    if (KNOWN_OPEN[key] && !d.afterOk) d.open = KNOWN_OPEN[key];
    if (before && !before.s.sc.ok && after.s.sc.ok) {
      if (r.state === "Ready") d.why = `row was Ready in the recorded run (its harness scored the wall ok); only the re-scored v4 rule calls it ${sampleVerdict(before.s.five)}`;
      else if (d.otherFailures.length) d.why = `wall now ok; row still fails: ${d.otherFailures[0].slice(0, 140)}`;
      else if (LISTED_FALSE.has(r.id)) d.why = `listed false ${sampleVerdict(before.s.five)}: area ${d.area} (lit ${d.contentLit}, varied ${d.varied})`;
      else if (REVIEWED_DRAWN[key]) d.why = `not listed, drawn by eye: ${REVIEWED_DRAWN[key]}`;
      else bad.push("unexpected fail -> ok: not a listed false black/uniform, not reviewed by eye, and the wall was the row's only failure");
    } else if (before && before.s.sc.ok && !after.s.sc.ok) d.why = `ok -> fail: ${after.s.sc.note ?? after.s.sc.by}`;
    d.pass = !bad.length; d.problems = bad; if (bad.length) failed++;
    rowsD.push(d);
    const word = (sc) => (sc.ok ? "ok" : sc.what);
    if (before && word(before.s.sc) !== word(after.s.sc)) changed.push(d);
    else if (before) d.byOnly = d.before !== d.after; // same verdict, other sample named
    if (before && before.shot !== after.shot) d.holdChange = `${before.shot === "35s" ? "held to 35s" : "not held"} -> ${after.shot === "35s" ? "held to 35s" : "not held"}`;
  }
}

const pad = (x, n) => String(x ?? "–").padEnd(n);
console.log(`rule under test: ${args.util}${isV5 ? " (v5: area decides at >= 40% judged)" : " (pre-v5 rule)"}${B ? `; before = ${args.baselineUtil}` : ""}\n`);
console.log(`${pad("case", 78)} ${pad("patch", 8)} ${pad("lums", 16)} ${pad("area", 9)} ${pad("lit", 7)} ${pad("varied", 7)} ${pad("masked", 7)} ${pad("litVsBg", 7)} ${pad("edge16", 7)} ${B ? `${pad("before", 30)} ` : ""}after`);
for (const r of rows) {
  if (r.skipped) { console.log(`${pad(r.name, 78)} skipped (missing ${r.file})`); continue; }
  console.log(`${pad(r.name, 78)} ${pad(r.patch, 8)} ${pad(r.patchLums, 16)} ${pad(r.area, 9)} ${pad(r.contentLit, 7)} ${pad(r.varied, 7)} ${pad(r.maskedFraction, 7)} ${pad(r.litVsBg, 7)} ${pad(r.edge16, 7)} ${B ? `${pad(r.before, 30)} ` : ""}${r.after}${r.decidedBy ? ` [${r.decidedBy}]` : ""}${r.after.startsWith("washed-out") && r.mode ? ` {${r.mode}}` : ""}${r.pass ? "" : `   <-- FAIL: ${r.problems.join("; ")}`}`);
}
if (rowsD.length) {
  const sweeps = [...new Set(rowsD.map((d) => d.sweep))];
  console.log(`\nPart D: ${rowsD.length} view rows re-scored from ${sweeps.length} saved sweep(s) (content area unmasked: no overlay rects were recorded)`);
  for (const d of rowsD.filter((x) => !x.pass)) console.log(`  FAIL ${d.sweep} ${d.id}: ${d.problems.join("; ")} (${d.after}; lit ${d.contentLit}, varied ${d.varied}; ${d.shotAfter})`);
  for (const d of rowsD.filter((x) => x.open)) console.log(`  OPEN ${d.sweep} ${d.id}: ${d.open} (${d.after}; lit ${d.contentLit}, varied ${d.varied}; ${d.shotAfter})`);
  if (B) {
    console.log(`\nRows whose wall verdict changed (${changed.length}):`);
    console.log(`  ${pad("sweep", 34)} ${pad("view", 26)} ${pad("before", 26)} ${pad("after", 26)} reason`);
    for (const d of changed) console.log(`  ${pad(d.sweep, 34)} ${pad(d.id, 26)} ${pad(d.before, 26)} ${pad(d.after, 26)} ${d.why ?? d.note ?? ""} [${d.shotAfter}]`);
  }
}
if (B && rowsD.some((d) => d.holdChange)) {
  const hc = rowsD.filter((d) => d.holdChange);
  console.log(`\nRows held differently (same wall verdict unless listed above) (${hc.length}):`);
  for (const d of hc) console.log(`  ${pad(d.sweep, 34)} ${pad(d.id, 26)} ${pad(d.holdChange, 28)} before ${d.before} on ${d.shotBefore}; after ${d.after} on ${d.shotAfter}${d.note ? ` (${d.note})` : ""}`);
}
if (args.json) writeFileSync(args.json, JSON.stringify({ util: args.util, baselineUtil: args.baselineUtil, rows, rowsD, changed: changed.map((d) => `${d.sweep} ${d.id}`) }, null, 1));
console.log(failed ? `\nFAIL: ${failed} case(s)` : "\nPASS: every case as expected");
process.exit(failed ? 1 : 0);
