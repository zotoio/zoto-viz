/** Branded WebGL context generation — only bump via {@link mintContextGen} in the host. */

declare const contextGenBrand: unique symbol;

export type ContextGen = number & { readonly [contextGenBrand]: true };

export function mintContextGen(n: number): ContextGen {
  return n as ContextGen;
}
