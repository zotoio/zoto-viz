export function probe(): void {
  if (typeof parent !== "undefined") void parent;
}
