declare module 'd3-force-3d' {
	export interface ForceCollide<NodeDatum> {
		(alpha: number): void;
		initialize?(nodes: NodeDatum[], random?: () => number): void;
		radius(radius: number | ((node: NodeDatum) => number)): ForceCollide<NodeDatum>;
		strength?(strength: number): ForceCollide<NodeDatum>;
		iterations?(iterations: number): ForceCollide<NodeDatum>;
	}

	export function forceCollide<NodeDatum = unknown>(): ForceCollide<NodeDatum>;
}
