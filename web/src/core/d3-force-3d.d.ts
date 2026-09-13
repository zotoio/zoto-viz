declare module "d3-force-3d" {
  export interface SimNode { index?: number; x?: number; y?: number; z?: number; vx?: number; vy?: number; vz?: number; fx?: number | null; fy?: number | null; fz?: number | null }
  export interface SimLink<N> { source: N | string | number; target: N | string | number; index?: number }
  export interface Force<N> { (alpha: number): void; initialize?(nodes: N[], random?: () => number, nDim?: number): void }
  export interface Simulation<N extends SimNode, L extends SimLink<N>> {
    tick(iterations?: number): this;
    nodes(): N[]; nodes(nodes: N[]): this;
    alpha(): number; alpha(a: number): this;
    alphaTarget(): number; alphaTarget(a: number): this;
    alphaDecay(): number; alphaDecay(a: number): this;
    velocityDecay(): number; velocityDecay(a: number): this;
    force(name: string): Force<N> | undefined; force(name: string, force: Force<N> | null): this;
    stop(): this; restart(): this;
    numDimensions(): number; numDimensions(n: number): this;
  }
  export interface ForceLink<N, L> extends Force<N> {
    links(): L[]; links(l: L[]): this;
    id(fn: (n: N) => string): this;
    distance(d: number | ((l: L) => number)): this;
    strength(s: number | ((l: L) => number)): this;
  }
  export interface ForceManyBody<N> extends Force<N> { strength(s: number | ((n: N) => number)): this; distanceMax(d: number): this; distanceMin(d: number): this; theta(t: number): this }
  export interface ForceRadial<N> extends Force<N> { radius(r: number | ((n: N) => number)): this; strength(s: number | ((n: N) => number)): this }
  export interface ForceCenter<N> extends Force<N> { strength(s: number): this }
  export function forceSimulation<N extends SimNode, L extends SimLink<N> = SimLink<N>>(nodes?: N[], nDim?: number): Simulation<N, L>;
  export function forceLink<N extends SimNode, L extends SimLink<N>>(links?: L[]): ForceLink<N, L>;
  export function forceManyBody<N extends SimNode>(): ForceManyBody<N>;
  export function forceCenter<N extends SimNode>(x?: number, y?: number, z?: number): ForceCenter<N>;
  export function forceRadial<N extends SimNode>(radius: number | ((n: N) => number), x?: number, y?: number, z?: number): ForceRadial<N>;
  export function forceCollide<N extends SimNode>(radius?: number | ((n: N) => number)): Force<N>;
}
