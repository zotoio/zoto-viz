import * as THREE from "three";
import {
  PACK_MSAA_SAMPLES,
  PackMirrorRegistry,
  SandboxBitmapGl,
} from "./pack-mirror-gl";
import {
  createPackMirrorArrowCanvas,
} from "./pack-mirror-arrow-fixture";
import {
  PACK_MIRROR_QUADRANT_RGBA,
  createPackMirrorQuadrantCanvas,
} from "./pack-mirror-quadrant-fixture";
import { letterboxInnerRectInto, surfaceLetterboxFill } from "./letterbox-fill";
import {
  asCanvasDeviceHeight,
  cssRect,
  cssRectTopFromBottomLeft,
  deviceSizeFromCssBox,
  glRect,
  toDeviceRectInto,
  toGlRectInto,
  type DeviceRect,
  type DeviceRectMut,
  type GlRectMut,
} from "./pack-mirror-rect";
import { glReadPixels1x1 } from "./pack-mirror-rect.boundary";

const captureScratch: DeviceRectMut = { x: 0, y: 0, w: 0, h: 0 };
const glCaptureScratch: GlRectMut = { x: 0, y: 0, w: 0, h: 0 };
const innerTdScratch = { x: 0, y: 0, w: 0, h: 0 };

export type PackMirrorReadbackInput = {
  /** Window / layout DPR (browser zoom). */
  windowDpr: number;
  /** Renderer `setPixelRatio` — production uses `min(windowDpr, 1.5)`. */
  rendererDpr?: number;
  antialias: boolean;
  path: "host" | "sandbox";
  /** Quadrant readback (zoom boundary); default keeps arrow fixture for legacy matrix rows. */
  mode?: "arrow" | "quadrant";
};

export type PackMirrorReadbackResult = {
  primaryCenter: [number, number, number, number];
  mirrorCenter: [number, number, number, number];
  letterboxBarCenter: [number, number, number, number];
  contentNonEmpty: boolean;
  mirrorArrowUp: boolean;
  letterboxColored: boolean;
  quadrantTlOk?: boolean;
  quadrantBrOk?: boolean;
  msaaSamples: number;
  glRenderer: string;
  windowDpr: number;
  rendererDpr: number;
};

function readPixelDevice(
  gl: WebGL2RenderingContext,
  x: number,
  y: number,
): [number, number, number, number] {
  const buf = new Uint8Array(4);
  glReadPixels1x1(gl, glRect(x, y, 1, 1), buf);
  return [buf[0], buf[1], buf[2], buf[3]];
}

const HARNESS_CSS_HEIGHT = 120;

function readPixelCssBottomLeft(
  gl: WebGL2RenderingContext,
  x: number,
  yBottom: number,
  pr: number,
  canvasDeviceHeight: number,
): [number, number, number, number] {
  toDeviceRectInto(
    cssRect(x, HARNESS_CSS_HEIGHT - yBottom - 1, 1, 1),
    pr,
    captureScratch,
  );
  toGlRectInto(
    captureScratch as DeviceRect,
    asCanvasDeviceHeight(canvasDeviceHeight),
    glCaptureScratch,
  );
  const cx = glCaptureScratch.x + Math.max(0, Math.floor((glCaptureScratch.w - 1) / 2));
  const cy = glCaptureScratch.y + Math.max(0, Math.floor((glCaptureScratch.h - 1) / 2));
  return readPixelDevice(gl, cx, cy);
}

/** Wall clear in harness (`0x222233`). */
export const PACK_MIRROR_READBACK_WALL_RGBA: [number, number, number, number] = [34, 34, 51, 255];

const ARROW_RED_MIN = 120;
const ORIENTATION_MARGIN = 24;
const QUADRANT_DOMINANCE = 40;

function rgbaNear(
  px: [number, number, number, number],
  ref: [number, number, number, number],
  tol = 10,
): boolean {
  return (
    Math.abs(px[0] - ref[0]) <= tol
    && Math.abs(px[1] - ref[1]) <= tol
    && Math.abs(px[2] - ref[2]) <= tol
  );
}

function dominantChannel(
  px: [number, number, number, number],
): "r" | "g" | "b" | "y" | "none" {
  const [r, g, b] = px;
  if (r > g + QUADRANT_DOMINANCE && r > b + QUADRANT_DOMINANCE) return "r";
  if (g > r + QUADRANT_DOMINANCE && g > b + QUADRANT_DOMINANCE) return "g";
  if (b > r + QUADRANT_DOMINANCE && b > g + QUADRANT_DOMINANCE) return "b";
  if (r > 150 && g > 130 && b < 140 && r + g > b + 200) return "y";
  return "none";
}

function maxRedInRect(
  gl: WebGL2RenderingContext,
  band: DeviceRect,
  canvasDeviceHeight: number,
): number {
  toGlRectInto(band, asCanvasDeviceHeight(canvasDeviceHeight), glCaptureScratch);
  const x0 = glCaptureScratch.x;
  const y0 = glCaptureScratch.y;
  const w = glCaptureScratch.w;
  const h = glCaptureScratch.h;
  let max = 0;
  const x1 = x0 + Math.max(1, w);
  const y1 = y0 + Math.max(1, h);
  const mx = Math.max(3, Math.floor(Math.min(w, h) * 0.25));
  const cx = x0 + Math.floor(w / 2);
  const cy = y0 + Math.floor(h / 2);
  for (let dy = -mx; dy <= mx; dy += Math.max(1, Math.floor(mx / 2))) {
    for (let dx = -mx; dx <= mx; dx += Math.max(1, Math.floor(mx / 2))) {
      const x = cx + dx;
      const y = cy + dy;
      if (x < x0 || x >= x1 || y < y0 || y >= y1) continue;
      max = Math.max(max, readPixelDevice(gl, x, y)[0]);
    }
  }
  return max;
}

function arrowScene(pw: number, ph: number): { scene: THREE.Scene; camera: THREE.Camera } {
  const canvas = createPackMirrorArrowCanvas();
  const tex = new THREE.CanvasTexture(canvas);
  tex.flipY = true;
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(0, pw, ph, 0, -1, 1);
  const mat = new THREE.MeshBasicMaterial({ map: tex });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(pw, ph), mat);
  mesh.position.set(pw / 2, ph / 2, 0);
  scene.add(mesh);
  return { scene, camera };
}

function quadrantScene(pw: number, ph: number): { scene: THREE.Scene; camera: THREE.Camera } {
  const canvas = createPackMirrorQuadrantCanvas();
  const tex = new THREE.CanvasTexture(canvas);
  tex.flipY = true;
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(0, pw, ph, 0, -1, 1);
  const mat = new THREE.MeshBasicMaterial({ map: tex });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(pw, ph), mat);
  mesh.position.set(pw / 2, ph / 2, 0);
  scene.add(mesh);
  return { scene, camera };
}

function rendererDprFor(input: PackMirrorReadbackInput): number {
  return input.rendererDpr ?? Math.min(input.windowDpr, 1.5);
}

/** Runs inside headless Chrome (SwiftShader); throws on failure (no silent skip). */
export async function runPackMirrorReadbackInPage(
  input: PackMirrorReadbackInput,
): Promise<PackMirrorReadbackResult> {
  const windowDpr = input.windowDpr;
  const rendererDpr = rendererDprFor(input);
  const mode = input.mode ?? "arrow";
  const wall = document.createElement("div");
  wall.style.cssText = "position:fixed;left:0;top:0;width:200px;height:120px;";
  document.body.appendChild(wall);

  const primaryBox = cssRect(0, 0, 100, 80);
  const mirrorBox = cssRect(100, 0, 60, 70);
  const fill = surfaceLetterboxFill(0x0a1020, 0.25);

  const rd = new THREE.WebGLRenderer({
    antialias: input.antialias,
    alpha: false,
    preserveDrawingBuffer: true,
  });
  rd.setPixelRatio(rendererDpr);
  rd.setSize(200, 120, false);
  wall.appendChild(rd.domElement);
  rd.setScissorTest(false);
  rd.setViewport(0, 0, 200, 120);
  rd.setClearColor(0x222233, 1);
  rd.clear(true, true, true);

  const gl = rd.getContext() as WebGL2RenderingContext | null;
  if (!gl) throw new Error("WebGL2 canvas context unavailable");
  const attrs = gl.getContextAttributes();
  if (!attrs) throw new Error("WebGL context attributes unavailable");
  const dbg = gl.getExtension("WEBGL_debug_renderer_info");
  if (!dbg) throw new Error("WEBGL_debug_renderer_info unavailable");
  const glRenderer = String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL));
  if (!glRenderer) throw new Error("GL renderer string empty");
  const pr = rd.getPixelRatio();
  const canvasDeviceHeight = rd.domElement.height;
  const { pw, ph } = deviceSizeFromCssBox(primaryBox, pr);
  const sceneFactory = mode === "quadrant" ? quadrantScene : arrowScene;

  if (input.path === "host") {
    const reg = new PackMirrorRegistry();
    reg.syncScopes(new Map([["plugin:arrow", { tileCount: 2, antialias: input.antialias }]]));
    const { scene, camera } = sceneFactory(pw, ph);
    reg.renderPrimary("plugin:arrow", rd, scene, camera, primaryBox, 0x0a1020, input.antialias);
    reg.presentPack("plugin:arrow", rd, primaryBox, {
      letterbox: false,
      fill: null,
      aspect: primaryBox.w / primaryBox.h,
    });
    reg.presentPack("plugin:arrow", rd, mirrorBox, {
      letterbox: true,
      fill,
      aspect: primaryBox.w / primaryBox.h,
    });
    reg.dispose();
  } else {
    const gpu = new SandboxBitmapGl();
    const canvas = mode === "quadrant" ? createPackMirrorQuadrantCanvas() : createPackMirrorArrowCanvas();
    const bmp = await createImageBitmap(canvas);
    const tex = gpu.uploadFrame(bmp);
    if (!tex) throw new Error("sandbox texture upload failed");
    gpu.present(rd, tex, fill, mirrorBox, primaryBox.w / primaryBox.h);
    bmp.close();
    regPresentPrimaryForSandbox(rd, primaryBox, pw, ph, input.antialias, sceneFactory);
    gpu.dispose();
  }

  const primarySampleCss = mode === "quadrant"
    ? {
      x: primaryBox.x + primaryBox.w * 0.25,
      y: primaryBox.y + primaryBox.h * 0.75,
    }
    : {
      x: primaryBox.x + primaryBox.w * 0.5,
      y: primaryBox.y + primaryBox.h * 0.5,
    };
  const primaryCenter = readPixelCssBottomLeft(
    gl,
    primarySampleCss.x,
    primarySampleCss.y,
    pr,
    canvasDeviceHeight,
  );

  letterboxInnerRectInto(mirrorBox, primaryBox.w / primaryBox.h, innerTdScratch);
  const innerTd = innerTdScratch;
  const innerX = mirrorBox.x + innerTd.x;
  const innerY = mirrorBox.y + (mirrorBox.h - innerTd.y - innerTd.h);
  const mirrorCenter = readPixelCssBottomLeft(
    gl,
    innerX + innerTd.w * 0.5,
    innerY + innerTd.h * 0.5,
    pr,
    canvasDeviceHeight,
  );

  const topBarBottom = innerY + innerTd.h;
  const topBarTop = mirrorBox.y + mirrorBox.h;
  const barCenterY = topBarBottom + (topBarTop - topBarBottom) * 0.5;
  const letterboxBarCenter = readPixelCssBottomLeft(
    gl,
    mirrorBox.x + mirrorBox.w * 0.5,
    barCenterY,
    pr,
    canvasDeviceHeight,
  );

  const marginX = Math.max(2, innerTd.w * 0.15);
  const marginY = Math.max(2, innerTd.h * 0.15);
  const bandW = Math.max(2, innerTd.w * 0.35);
  const bandH = Math.max(2, innerTd.h * 0.35);
  const tlBand = cssRectTopFromBottomLeft(
    cssRect(
      innerX + marginX,
      innerY + innerTd.h - marginY - bandH,
      bandW,
      bandH,
    ),
    HARNESS_CSS_HEIGHT,
  );
  const brBand = cssRectTopFromBottomLeft(
    cssRect(
      innerX + innerTd.w - marginX - bandW,
      innerY + marginY,
      bandW,
      bandH,
    ),
    HARNESS_CSS_HEIGHT,
  );
  toDeviceRectInto(tlBand, pr, captureScratch);
  const topLeftPeak = maxRedInRect(gl, captureScratch as DeviceRect, canvasDeviceHeight);
  toDeviceRectInto(brBand, pr, captureScratch);
  const bottomRightPeak = maxRedInRect(gl, captureScratch as DeviceRect, canvasDeviceHeight);

  let quadrantTlOk: boolean | undefined;
  let quadrantBrOk: boolean | undefined;
  if (mode === "quadrant") {
    const tlPx = readPixelCssBottomLeft(
      gl,
      innerX + innerTd.w * 0.25,
      innerY + innerTd.h * 0.75,
      pr,
      canvasDeviceHeight,
    );
    const brPx = readPixelCssBottomLeft(
      gl,
      innerX + innerTd.w * 0.75,
      innerY + innerTd.h * 0.25,
      pr,
      canvasDeviceHeight,
    );
    quadrantTlOk = dominantChannel(tlPx) === "r";
    quadrantBrOk = dominantChannel(brPx) === "y";
    if (!quadrantTlOk || !quadrantBrOk) {
      throw new Error(
        `quadrant orientation wrong at windowDpr=${windowDpr} rendererDpr=${rendererDpr}: tl=${dominantChannel(tlPx)} br=${dominantChannel(brPx)} rgba tl=${tlPx.join(",")} br=${brPx.join(",")}`,
      );
    }
    void PACK_MIRROR_QUADRANT_RGBA;
  }

  const contentNonEmpty = !rgbaNear(primaryCenter, PACK_MIRROR_READBACK_WALL_RGBA)
    && (mode === "quadrant" ? dominantChannel(primaryCenter) !== "none" : primaryCenter[0] >= ARROW_RED_MIN);
  const mirrorHasArrow = mode === "quadrant"
    ? quadrantTlOk === true
    : topLeftPeak >= ARROW_RED_MIN;
  const mirrorArrowUp = mode === "quadrant"
    ? quadrantTlOk === true && quadrantBrOk === true
    : topLeftPeak > bottomRightPeak + ORIENTATION_MARGIN;
  const letterboxColored = !rgbaNear(letterboxBarCenter, PACK_MIRROR_READBACK_WALL_RGBA);

  rd.dispose();
  wall.remove();

  if (!contentNonEmpty) throw new Error(`primary tile empty at center: rgba(${primaryCenter.join(",")})`);
  if (!mirrorHasArrow) {
    throw new Error(`mirror center missing content: rgba(${mirrorCenter.join(",")}) peaks tl/br=${topLeftPeak}/${bottomRightPeak}`);
  }
  if (input.path === "host" && mode === "arrow" && !mirrorArrowUp) {
    throw new Error(`mirror arrow orientation wrong: topLeft=${topLeftPeak} bottomRight=${bottomRightPeak}`);
  }
  if (input.path === "sandbox" && mode === "arrow" && !mirrorHasArrow) {
    throw new Error(`sandbox mirror missing arrow: topLeft=${topLeftPeak}`);
  }
  if (!letterboxColored) throw new Error(`letterbox bar not surface colour at center: rgba(${letterboxBarCenter.join(",")})`);

  const sessionSamples = input.antialias ? PACK_MSAA_SAMPLES : 0;
  return {
    primaryCenter,
    mirrorCenter,
    letterboxBarCenter,
    contentNonEmpty,
    mirrorArrowUp: input.path === "host" ? mirrorArrowUp : mirrorHasArrow,
    letterboxColored,
    quadrantTlOk,
    quadrantBrOk,
    msaaSamples: sessionSamples,
    glRenderer,
    windowDpr,
    rendererDpr,
  };
}

function regPresentPrimaryForSandbox(
  rd: THREE.WebGLRenderer,
  primaryBox: ReturnType<typeof cssRect>,
  pw: number,
  ph: number,
  antialias: boolean,
  sceneFactory: (pw: number, ph: number) => { scene: THREE.Scene; camera: THREE.Camera },
): void {
  const reg = new PackMirrorRegistry();
  reg.syncScopes(new Map([["plugin:arrow", { tileCount: 2, antialias }]]));
  const { scene, camera } = sceneFactory(pw, ph);
  reg.renderPrimary("plugin:arrow", rd, scene, camera, primaryBox, 0x0a1020, antialias);
  reg.presentPack("plugin:arrow", rd, primaryBox, {
    letterbox: false,
    fill: null,
    aspect: primaryBox.w / primaryBox.h,
  });
  reg.dispose();
}
