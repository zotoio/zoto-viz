import * as THREE from "three";
import {
  PACK_MSAA_SAMPLES,
  PackMirrorRegistry,
  SandboxBitmapGl,
} from "./pack-mirror-gl";
import {
  createPackMirrorArrowCanvas,
} from "./pack-mirror-arrow-fixture";
import { letterboxInnerRect, surfaceLetterboxFill } from "./letterbox-fill";

export type PackMirrorReadbackInput = {
  dpr: number;
  antialias: boolean;
  path: "host" | "sandbox";
};

export type PackMirrorReadbackResult = {
  primaryCenter: [number, number, number, number];
  mirrorCenter: [number, number, number, number];
  letterboxBarCenter: [number, number, number, number];
  contentNonEmpty: boolean;
  mirrorArrowUp: boolean;
  letterboxColored: boolean;
  msaaSamples: number;
  glRenderer: string;
};

function readPixel(
  gl: WebGL2RenderingContext,
  x: number,
  y: number,
): [number, number, number, number] {
  const buf = new Uint8Array(4);
  gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, buf);
  return [buf[0], buf[1], buf[2], buf[3]];
}

function channelEnergy(px: [number, number, number, number]): number {
  return Math.max(px[0], px[1], px[2]);
}

function maxRedInRect(
  gl: WebGL2RenderingContext,
  x0: number,
  y0: number,
  w: number,
  h: number,
): number {
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
      max = Math.max(max, readPixel(gl, x, y)[0]);
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

/** Runs inside headless Chrome (SwiftShader); throws on failure (no silent skip). */
export async function runPackMirrorReadbackInPage(
  input: PackMirrorReadbackInput,
): Promise<PackMirrorReadbackResult> {
  const wall = document.createElement("div");
  wall.style.cssText = "position:fixed;left:0;top:0;width:200px;height:120px;";
  document.body.appendChild(wall);

  const primaryBox = { w: 100, h: 80 };
  const mirrorBox = { x: 100, y: 0, w: 60, h: 70 };
  const fill = surfaceLetterboxFill(0x0a1020, 0.25);

  const rd = new THREE.WebGLRenderer({
    antialias: input.antialias,
    alpha: false,
    preserveDrawingBuffer: true,
  });
  rd.setPixelRatio(input.dpr);
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
  const pw = Math.max(2, Math.round(primaryBox.w * input.dpr));
  const ph = Math.max(2, Math.round(primaryBox.h * input.dpr));

  if (input.path === "host") {
    const reg = new PackMirrorRegistry();
    reg.syncScopes(new Map([["plugin:arrow", { tileCount: 2, antialias: input.antialias }]]));
    const { scene, camera } = arrowScene(pw, ph);
    reg.renderPrimary("plugin:arrow", rd, scene, camera, primaryBox, 0x0a1020, input.antialias);
    reg.presentPack("plugin:arrow", rd, { x: 0, y: 0, w: primaryBox.w, h: primaryBox.h }, {
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
    const canvas = createPackMirrorArrowCanvas();
    const bmp = await createImageBitmap(canvas);
    const tex = gpu.uploadFrame(bmp);
    if (!tex) throw new Error("sandbox texture upload failed");
    gpu.present(rd, tex, fill, mirrorBox, primaryBox.w / primaryBox.h);
    bmp.close();
    regPresentPrimaryForSandbox(rd, primaryBox, pw, ph, input.antialias);
    gpu.dispose();
  }

  const primaryCenter = readPixel(
    gl,
    Math.round(primaryBox.w * 0.5 * input.dpr),
    Math.round(primaryBox.h * 0.5 * input.dpr),
  );

  const innerTd = letterboxInnerRect(mirrorBox, primaryBox.w / primaryBox.h);
  const innerX = mirrorBox.x + innerTd.x;
  const innerY = mirrorBox.y + (mirrorBox.h - innerTd.y - innerTd.h);
  const mirrorCenter = readPixel(
    gl,
    Math.round((innerX + innerTd.w * 0.5) * input.dpr),
    Math.round((innerY + innerTd.h * 0.5) * input.dpr),
  );

  const topBarBottom = innerY + innerTd.h;
  const topBarTop = mirrorBox.y + mirrorBox.h;
  const barCenterY = topBarBottom + (topBarTop - topBarBottom) * 0.5;
  const letterboxBarCenter = readPixel(
    gl,
    Math.round((mirrorBox.x + mirrorBox.w * 0.5) * input.dpr),
    Math.round(barCenterY * input.dpr),
  );

  const innerPxX = Math.round(innerX * input.dpr);
  const innerPxY = Math.round(innerY * input.dpr);
  const innerPxW = Math.round(innerTd.w * input.dpr);
  const innerPxH = Math.round(innerTd.h * input.dpr);
  const marginX = Math.max(2, Math.floor(innerPxW * 0.15));
  const marginY = Math.max(2, Math.floor(innerPxH * 0.15));
  const bandW = Math.max(2, Math.floor(innerPxW * 0.35));
  const bandH = Math.max(2, Math.floor(innerPxH * 0.35));
  const topLeftPeak = maxRedInRect(
    gl,
    innerPxX + marginX,
    innerPxY + innerPxH - marginY - bandH,
    bandW,
    bandH,
  );
  const bottomRightPeak = maxRedInRect(
    gl,
    innerPxX + innerPxW - marginX - bandW,
    innerPxY + marginY,
    bandW,
    bandH,
  );

  const contentNonEmpty = channelEnergy(primaryCenter) > 20;
  const mirrorHasArrow = channelEnergy(mirrorCenter) > 20 || topLeftPeak > 20;
  const mirrorArrowUp = topLeftPeak >= bottomRightPeak;
  const letterboxColored = channelEnergy(letterboxBarCenter) > 8;

  rd.dispose();
  wall.remove();

  if (!contentNonEmpty) throw new Error(`primary tile empty at center: rgba(${primaryCenter.join(",")})`);
  if (!mirrorHasArrow) throw new Error(`mirror center missing arrow: rgba(${mirrorCenter.join(",")}) peaks tl/br=${topLeftPeak}/${bottomRightPeak}`);
  if (!mirrorArrowUp) throw new Error(`mirror arrow orientation wrong: topLeft=${topLeftPeak} bottomRight=${bottomRightPeak}`);
  if (!letterboxColored) throw new Error(`letterbox bar not surface colour at center: rgba(${letterboxBarCenter.join(",")})`);

  const sessionSamples = input.antialias ? PACK_MSAA_SAMPLES : 0;
  return {
    primaryCenter,
    mirrorCenter,
    letterboxBarCenter,
    contentNonEmpty,
    mirrorArrowUp,
    letterboxColored,
    msaaSamples: sessionSamples,
    glRenderer,
  };
}

function regPresentPrimaryForSandbox(
  rd: THREE.WebGLRenderer,
  primaryBox: { w: number; h: number },
  pw: number,
  ph: number,
  antialias: boolean,
): void {
  const reg = new PackMirrorRegistry();
  reg.syncScopes(new Map([["plugin:arrow", { tileCount: 2, antialias }]]));
  const { scene, camera } = arrowScene(pw, ph);
  reg.renderPrimary("plugin:arrow", rd, scene, camera, primaryBox, 0x0a1020, antialias);
  reg.presentPack("plugin:arrow", rd, { x: 0, y: 0, w: primaryBox.w, h: primaryBox.h }, {
    letterbox: false,
    fill: null,
    aspect: primaryBox.w / primaryBox.h,
  });
  reg.dispose();
}
