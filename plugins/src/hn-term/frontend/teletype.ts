export const TERM_COLS = 14;
export const TERM_ROWS = 4;
export const TERM_META = 8;

export type Story = { title: string; body: string };

export function preferHnStories(
  headlines: { id?: string; label?: string; text?: string; summary?: string }[],
): Story[] {
  return headlines
    .map((h) => ({ title: (h.text ?? "").trim(), body: (h.summary ?? "").trim() }))
    .filter((s) => s.title || s.body);
}

export function scriptFromStories(stories: Story[]): string {
  if (!stories.length) return "$ hn\nwaiting for headlines...\n";
  return stories.map((s) => {
    const head = `$ ${s.title || "story"}`;
    const body = s.body && s.body !== s.title ? `\n${s.body}` : "";
    return `${head}${body}\n`;
  }).join("\n");
}

export function wrapLines(text: string, cols: number): string[] {
  const lines: string[] = [];
  for (const para of text.split("\n")) {
    if (!para) {
      lines.push("");
      continue;
    }
    let rest = para;
    while (rest.length > cols) {
      let cut = rest.lastIndexOf(" ", cols);
      if (cut < cols * 0.4) cut = cols;
      lines.push(rest.slice(0, cut).trimEnd());
      rest = rest.slice(cut).trimStart();
    }
    lines.push(rest);
  }
  return lines;
}

export function visibleScreen(script: string, typed: number, cols: number, rows: number): {
  cells: string;
  cursorCol: number;
  cursorRow: number;
} {
  const shown = script.slice(0, Math.max(0, Math.floor(typed)));
  const wrapped = wrapLines(shown, cols);
  const start = Math.max(0, wrapped.length - rows);
  const window = wrapped.slice(start);
  while (window.length < rows) window.unshift("");
  const last = window[window.length - 1] ?? "";
  const cells = window.map((l) => l.padEnd(cols, " ").slice(0, cols)).join("");
  return { cells, cursorCol: Math.min(cols - 1, last.length), cursorRow: rows - 1 };
}

export function packScreen(
  screen: { cells: string; cursorCol: number; cursorRow: number },
  audio: number,
  blink: number,
): number[] {
  const buf = [
    TERM_COLS, TERM_ROWS, screen.cursorCol, screen.cursorRow,
    blink, Math.min(1, Math.max(0, audio)), 0, 0,
  ];
  const n = TERM_COLS * TERM_ROWS;
  for (let i = 0; i < n; i++) {
    const c = screen.cells.charCodeAt(i) || 32;
    const up = c >= 97 && c <= 122 ? c - 32 : c;
    const code = up >= 32 && up <= 90 ? up : 32;
    buf.push((code - 32) / 95);
  }
  return buf;
}
