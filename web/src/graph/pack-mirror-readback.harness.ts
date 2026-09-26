import * as THREE from "three";
import {
  PACK_MSAA_SAMPLES,
  PackMirrorRegistry,
  SandboxBitmapGl,
} from "./pack-mirror-gl";
import {
  createPackMirrorArrowCanvas,
  PACK_MIRROR_ARROW_H,
  PACK_MIRROR_ARROW_W,
} from "./pack-mirror-arrow-fixture";
import { letterboxFillHex, letterboxInnerRect, surfaceLetterboxFill } from "./letterbox-fill";

export type PackMirrorReadbackInput = {
  dpr: number;
  antialias: boolean;
  path: "host" | "sandbox";
};

export type PackMirrorReadbackResult = {
  primaryTopLeft: [number, number, number, number];
  mirrorTopLeft: [number, number, number, number];
  letterboxBar: [number, number, number, number];
  contentNonEmpty: boolean;
  msaaSamples: number;
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
  for (let y = y0; y < y1; y += 2) {
    for (let x = x0; x < x1; x += 2) {
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
  const barHex = letterboxFillHex(fill);

  const rd = new THREE.WebGLRenderer({
    antialias: input.antialias,
    alpha: false,
    preserveDrawingBuffer: true,
  });
  rd.setPixelRatio(input.dpr);
  const cw = Math.round(200 * input.dpr);
  const ch = Math.round(120 * input.dpr);
  rd.setSize(200, 120, false);
  wall.appendChild(rd.domElement);
  rd.setScissorTest(false);
  rd.setViewport(0, 0, 200, 120);
  rd.setClearColor(0x222233, 1);
  rd.clear(true, true, true);

  const gl = rd.getContext() as WebGL2RenderingContext;
  const attrs = gl.getContextAttributes();
  if (!attrs) throw new Error("WebGL context attributes unavailable");
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

  const tlX = Math.round(4 * input.dpr);
  const tlY = Math.round((primaryBox.h - 6) * input.dpr);
  const primaryTopLeft = readPixel(gl, tlX, tlY);

  const innerTd = letterboxInnerRect(mirrorBox, primaryBox.w / primaryBox.h);
  const innerX = mirrorBox.x + innerTd.x;
  const innerY = mirrorBox.y + (mirrorBox.h - innerTd.y - innerTd.h);
  const mtlX = Math.round((innerX + 4) * input.dpr);
  const mtlY = Math.round((innerY + innerTd.h - 6) * input.dpr);
  const mirrorTopLeft = readPixel(gl, mtlX, mtlY);

  const barX = Math.round((mirrorBox.x + mirrorBox.w / 2) * input.dpr);
  const topBarMid = innerY + innerTd.h + (mirrorBox.h - innerTd.y - innerTd.h) / 2;
  const barY = Math.round(topBarMid * input.dpr);
  const letterboxBar = readPixel(gl, barX, barY);

  const innerPxX = Math.round(innerX * input.dpr);
  const innerPxY = Math.round(innerY * input.dpr);
  const innerPxW = Math.round(innerTd.w * input.dpr);
  const innerPxH = Math.round(innerTd.h * input.dpr);
  const mirrorRedPeak = maxRedInRect(gl, innerPxX, innerPxY, innerPxW, innerPxH);
  const contentNonEmpty = primaryTopLeft[0] > 40 || primaryTopLeft[1] > 20;
  const arrowInMirror = mirrorTopLeft[0] > 40 || mirrorRedPeak > 40;
  const barMatchesSurface = Math.abs(letterboxBar[0] - ((barHex >> 16) & 255)) < 8
    && letterboxBar[0] > 5;

  rd.dispose();
  wall.remove();

  if (!contentNonEmpty) throw new Error(`primary tile empty at TL: rgba(${primaryTopLeft.join(",")})`);
  const tlPeak = maxRedInRect(
    gl,
    innerPxX,
    innerPxY + Math.floor(innerPxH / 2),
    Math.max(2, Math.floor(innerPxW / 2)),
    Math.max(2, Math.floor(innerPxH / 2)),
  );
  const brPeak = maxRedInRect(
    gl,
    innerPxX + Math.floor(innerPxW / 2),
    innerPxY,
    Math.max(2, Math.floor(innerPxW / 2)),
    Math.max(2, Math.floor(innerPxH / 2)),
  );
  if (!arrowInMirror) throw new Error(`mirror TL missing arrow: rgba(${mirrorTopLeft.join(",")}) peak=${mirrorRedPeak}`);
  if (tlPeak < brPeak) throw new Error(`mirror arrow flipped: tlPeak=${tlPeak} brPeak=${brPeak}`);
  if (!barMatchesSurface) throw new Error(`letterbox bar not surface colour: rgba(${letterboxBar.join(",")})`);

  const sessionSamples = input.antialias ? PACK_MSAA_SAMPLES : 0;
  return {
    primaryTopLeft,
    mirrorTopLeft,
    letterboxBar,
    contentNonEmpty,
    msaaSamples: sessionSamples,
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
