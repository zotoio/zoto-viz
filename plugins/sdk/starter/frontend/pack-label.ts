const LABEL_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789.-:· ";

/** Pack ASCII label into a float buffer (host/sky corner chip reads the same slot). */
export function encodeCornerLabel(text: string, out: Float32Array, offset: number, maxChars: number): void {
  const slice = text.slice(0, maxChars);
  for (let i = 0; i < maxChars; i++) {
    const ch = slice[i] ?? " ";
    const code = LABEL_CHARS.indexOf(ch);
    out[offset + i] = code >= 0 ? code / (LABEL_CHARS.length - 1) : 0;
  }
}

export const CORNER_LABEL_OFFSET = 9;
export const CORNER_LABEL_CHARS = 22;
