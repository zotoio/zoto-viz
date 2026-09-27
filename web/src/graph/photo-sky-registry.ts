import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BACKDROP_OPTIONS, PHOTO_SKIES, type PhotoSkyKind } from "./backdrop";

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const skiesDir = path.join(webRoot, "public", "skies");

/** Every {@link PhotoSkyKind} must have a JPEG, url map entry, and photo-group picker row. */
export function assertPhotoSkyRegistry(kinds?: readonly PhotoSkyKind[]): void {
  const all = allPhotoSkyKinds();
  const list = kinds ?? all;
  const missingKinds = all.filter((k) => !list.includes(k));
  if (missingKinds.length) {
    throw new Error(`photo sky registry missing kinds: ${missingKinds.join(",")}`);
  }
  const missingUrl: string[] = [];
  const missingPicker: string[] = [];
  const missingFile: string[] = [];
  for (const kind of list) {
    if (!PHOTO_SKIES[kind]) missingUrl.push(kind);
    const opt = BACKDROP_OPTIONS.find((o) => o.value === kind && o.group === "photo");
    if (!opt) missingPicker.push(kind);
    const jpg = path.join(skiesDir, `${kind}.jpg`);
    if (!existsSync(jpg)) missingFile.push(kind);
  }
  if (missingUrl.length || missingPicker.length || missingFile.length) {
    throw new Error(
      `photo sky registry incomplete: url=${missingUrl.join(",")} picker=${missingPicker.join(",")} file=${missingFile.join(",")}`,
    );
  }
}

export function allPhotoSkyKinds(): PhotoSkyKind[] {
  return Object.keys(PHOTO_SKIES) as PhotoSkyKind[];
}
