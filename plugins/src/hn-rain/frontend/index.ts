/** Phosphor rain — HN / host source headlines become the glyph stream. */

type VizFrame = {
  t: number;
  audio: number;
  packets: { field: number }[];
  headlines?: { id: string; label: string; text: string }[];
};

declare const zoto: {
  onFrame: ((frame: VizFrame) => void) | null;
  writeBuffer: (slot: number, data: number[]) => void;
  writeUniform: (name: string, value: number | [number, number, number]) => void;
};

function preferHn(headlines: NonNullable<VizFrame["headlines"]>): string[] {
  const hn = headlines.filter((h) => /hn|hacker/i.test(`${h.id} ${h.label}`));
  return (hn.length ? hn : headlines).map((h) => h.text).filter(Boolean);
}

function packHeadlines(titles: string[], field: number, audio: number): number[] {
  const joined = (titles.join(" / ") || "HN RAIN").toUpperCase();
  const n = Math.min(60, joined.length);
  const buf = [titles.length, n / 60, field, audio];
  for (let i = 0; i < n; i++) {
    const c = joined.charCodeAt(i);
    buf.push((c >= 32 && c < 127 ? c - 32 : 0) / 95);
  }
  return buf;
}

zoto.onFrame = (frame) => {
  const titles = preferHn(frame.headlines ?? []);
  const field = frame.packets[0]?.field ?? 0;
  zoto.writeBuffer(0, packHeadlines(titles, field, frame.audio));
  zoto.writeUniform("uBright", 0.92 + Math.min(0.2, titles.length * 0.02) + frame.audio * 0.18);
  zoto.writeUniform("uAudio", frame.audio);
  zoto.writeUniform("uAccent", [0.35, 1.0, 0.42]);
};
