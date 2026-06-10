'use client';

import React, { useCallback, useEffect, FormEvent, useMemo, useRef, useState } from 'react';
import type { ForceGraphMethods, NodeObject, LinkObject } from 'react-force-graph-2d';
import Graph from 'graphology';

import {
	createGraphDataset,
	expandSelection,
	getDisplayedStats,
	getEndpointId,
	getKindLabel,
	getLinkKey,
	projectGraphData,
	isNodeInactive,
	createAdjacencyMap,
	createLinksByNodeId,
	type BadgeTone,
	type GraphDataset,
	type GraphLink,
	type GraphNode,
} from '@/lib/graph-data';

import { drawFirmNode, drawPersonNode } from '@/lib/geometry';

// --- Constants & Config ---
const CLICK_REVEAL_HOPS = 3;
const CLICK_REVEAL_HIGHLIGHT_MS = 1100;
const VISIBLE_NODE_IDS_STORAGE_KEY = 'graph-visible-node-ids-startup-leaders-v1';
// react-force-graph-2d radius = sqrt(nodeVal × NODE_REL_SIZE). Setting this to 100
// (vs default 4) makes the smallest node 5× bigger while preserving relative scale.
const NODE_REL_SIZE = 100;

type InitialGraphState = {
	dataset: GraphDataset;
	visibleNodeIds: Set<string>;
	selectedNodeId: string | null;
	visitedNodeIds: Set<string>;
	needsInitialLoad: boolean;
};

function computeInitialState(): InitialGraphState {
	const dataset = createGraphDataset();
	if (typeof window === 'undefined') {
		return { dataset, visibleNodeIds: new Set(), selectedNodeId: null, visitedNodeIds: new Set(), needsInitialLoad: false };
	}
	const pathMatch = window.location.pathname.match(/^\/node\/([^/]+)$/);
	if (pathMatch) {
		const nodeId = pathMatch[1];
		if (dataset.nodeById.has(nodeId)) {
			return { dataset, visibleNodeIds: expandSelection(dataset, nodeId), selectedNodeId: nodeId, visitedNodeIds: new Set(), needsInitialLoad: false };
		}
	}
	try {
		const raw = window.localStorage.getItem(VISIBLE_NODE_IDS_STORAGE_KEY);
		if (raw) {
			const stored = JSON.parse(raw) as { nodeIds?: string[]; selectedNodeId?: string; visitedNodeIds?: string[] };
			if (stored?.nodeIds?.length) {
				return {
					dataset,
					visibleNodeIds: new Set(stored.nodeIds),
					selectedNodeId: stored.selectedNodeId ?? null,
					visitedNodeIds: new Set(stored.visitedNodeIds ?? []),
					needsInitialLoad: false,
				};
			}
		}
	} catch {}
	return { dataset, visibleNodeIds: new Set(), selectedNodeId: null, visitedNodeIds: new Set(), needsInitialLoad: true };
}

export default function GraphView() {
	// Compute initial state once via lazy useState (avoids ref-during-render)
	const [{ dataset: initDataset, visibleNodeIds: initVisible, selectedNodeId: initSelected, visitedNodeIds: initVisited, needsInitialLoad }] = useState(computeInitialState);

	const [dataset, setDataset] = useState<GraphDataset>(() => initDataset);
	const graphRef = useRef<ForceGraphMethods<NodeObject<GraphNode>, LinkObject<GraphNode, GraphLink>> | undefined>(undefined);
	const [ForceGraph2D, setForceGraph2D] = useState<typeof import('react-force-graph-2d').default | null>(null);

	const [visibleNodeIds, setVisibleNodeIds] = useState<Set<string>>(() => initVisible);
	const [selectedNodeId, setSelectedNodeId] = useState<string | null>(() => initSelected);
	const [visitedNodeIds, setVisitedNodeIds] = useState<Set<string>>(() => initVisited);
	const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
	const [recentlyRevealedNodeIds, setRecentlyRevealedNodeIds] = useState<Set<string>>(() => new Set());
	const [searchQuery, setSearchQuery] = useState('');
	const [statusMessage, setStatusMessage] = useState('Ready. Search a name like "thornton" to display the graph.');
	const [showInfo, setShowInfo] = useState(true);
	const [showLog, setShowLog] = useState(false);
	const [traceMode, setTraceMode] = useState(false);
	const [showLegend, setShowLegend] = useState(false);
	const [menuOpen, setMenuOpen] = useState(true);
	const [panelPinned, setPanelPinned] = useState(true);

	const dragChildOffsetsRef = useRef<{ node: GraphNode & NodeObject; dx: number; dy: number }[]>([]);

	// WASM force simulation refs
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const wasmSimRef = useRef<any>(undefined);
	const wasmLoadedRef = useRef(false);
	const nodeIndexMapRef = useRef<Map<string, number>>(new Map());

	const visibleGraph = useMemo(() => projectGraphData(dataset, visibleNodeIds), [dataset, visibleNodeIds]);
	const activeNodeId = hoveredNodeId ?? selectedNodeId;
	const activeNode = activeNodeId ? (dataset.nodeById.get(activeNodeId) ?? null) : null;
	const displayedStats = useMemo(() => getDisplayedStats(visibleGraph), [visibleGraph]);

	const highlightedNodeIds = useMemo(() => {
		if (!activeNodeId) return new Set<string>();
		if (traceMode && selectedNodeId) return expandSelection(dataset, selectedNodeId);
		return new Set([activeNodeId]);
	}, [activeNodeId, dataset, selectedNodeId, traceMode]);

	// Render layer: 0 = inactive (drawn first/back), 1 = regular, 2 = hub, 3 = selected/highlighted (drawn last/front)
	const getNodeRenderLayer = useCallback(
		(node: GraphNode): number => {
			if (isNodeInactive(node)) return 0;
			if (node.id === selectedNodeId || highlightedNodeIds.has(node.id)) return 3;
			if (node.isHub) return 2;
			return 1;
		},
		[selectedNodeId, highlightedNodeIds],
	);

	// Sorted copy so canvas draws back→front: inactive first, hubs/selected last.
	// Same node object references are preserved so FA2 positions are not lost.
	const layeredGraph = useMemo(
		() => ({
			...visibleGraph,
			nodes: [...visibleGraph.nodes].sort((a, b) => getNodeRenderLayer(a) - getNodeRenderLayer(b)),
		}),
		[visibleGraph, getNodeRenderLayer],
	);

	const highlightedLinkIds = useMemo(() => {
		if (!activeNodeId) return new Set<string>();
		return new Set(
			visibleGraph.links
				.filter((link) => {
					const source = getEndpointId(link.source);
					const target = getEndpointId(link.target);
					if (traceMode) {
						return highlightedNodeIds.has(source) && highlightedNodeIds.has(target);
					}
					return source === activeNodeId || target === activeNodeId;
				})
				.map((link) => getLinkKey(link)),
		);
	}, [activeNodeId, highlightedNodeIds, traceMode, visibleGraph.links]);

	// Load the 2D renderer dynamically (avoids SSR)
	useEffect(() => {
		import('react-force-graph-2d').then((m) => setForceGraph2D(() => m.default));
	}, []);

	// Disable all d3 internal forces — WASM sim drives layout via onEngineTick
	useEffect(() => {
		if (!graphRef.current) return;
		const fg = graphRef.current;
		fg.d3Force('charge', null);
		fg.d3Force('link', null);
		fg.d3Force('center', null);
		fg.d3Force('collide', null);
	}, [ForceGraph2D]);

	// Load wasm_sim.js once on mount
	useEffect(() => {
		if (typeof window === 'undefined') return;
		const script = document.createElement('script');
		script.src = '/wasm-sim/wasm_sim.js';
		script.onload = () => {
			wasmLoadedRef.current = true;
		};
		document.head.appendChild(script);
		return () => {
			try {
				document.head.removeChild(script);
			} catch {}
		};
	}, []);

	// Build (or rebuild) the WASM sim whenever the graph data changes
	useEffect(() => {
		if (dataset.graphData.nodes.length === 0) return;
		let cancelled = false;

		const buildSim = async () => {
			// Wait for wasm_sim.js to finish loading
			if (!wasmLoadedRef.current) {
				await new Promise<void>((resolve) => {
					const interval = setInterval(() => {
						if (wasmLoadedRef.current) {
							clearInterval(interval);
							resolve();
						}
					}, 50);
				});
			}
			if (cancelled) return;

			// wasm-bindgen's classic-script output defines `wasm_bindgen` in the page's
			// global scope, not necessarily as `window.wasm_bindgen`.
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const wbg = (() => {
				try {
					return Function('return wasm_bindgen')() as any;
				} catch {
					return (globalThis as any).wasm_bindgen as any;
				}
			})();
			if (!wbg) throw new Error('wasm_bindgen is not available');
			const wasmModule = typeof wbg === 'function' ? (await wbg({ module_or_path: '/wasm-sim/wasm_sim_bg.wasm' }), wbg) : wbg;
			if (cancelled) return;

			// Free the previous simulation
			wasmSimRef.current?.free?.();

			const nodes = dataset.graphData.nodes;
			const indexMap = new Map<string, number>();
			nodes.forEach((n, i) => indexMap.set(n.id, i));
			nodeIndexMapRef.current = indexMap;

			const sim: {
				add_nodes_with_positions(p: Float32Array): void;
				add_edge(s: number, t: number): void;
				set_radii(r: Float32Array): void;
				build(ld: number, cs: number): void;
				tick(n: number): void;
				step(): void;
				get_positions(): Float32Array;
				reheat(): void;
				free(): void;
			} = new wasmModule.GraphSimulation();

			// Seed positions from current node.x/y (preserves layout on graph expansion)
			const initPos = new Float32Array(nodes.length * 2);
			nodes.forEach((n, i) => {
				initPos[i * 2] = n.x !== undefined && n.x !== null && isFinite(n.x as number) ? (n.x as number) : (Math.random() - 0.5) * 3000;
				initPos[i * 2 + 1] = n.y !== undefined && n.y !== null && isFinite(n.y as number) ? (n.y as number) : (Math.random() - 0.5) * 3000;
			});
			sim.add_nodes_with_positions(initPos);

			// Per-node collision radii matching visual pixel radii
			const radii = new Float32Array(nodes.length);
			nodes.forEach((n, i) => {
				radii[i] = Math.sqrt((n.size ?? 5) * NODE_REL_SIZE);
			});
			sim.set_radii(radii);

			// Edges
			for (const link of dataset.graphData.links) {
				const srcId = getEndpointId(link.source);
				const tgtId = getEndpointId(link.target);
				const si = indexMap.get(srcId);
				const ti = indexMap.get(tgtId);
				if (si !== undefined && ti !== undefined) sim.add_edge(si, ti);
			}

			// Build forces and warm up
			sim.build(120, -300);
			sim.tick(30);

			if (cancelled) {
				sim.free();
				return;
			}
			wasmSimRef.current = sim;
		};

		buildSim().catch(console.error);

		return () => {
			cancelled = true;
			wasmSimRef.current?.free?.();
			wasmSimRef.current = undefined;
		};
	}, [dataset]);

	const mergeGraphData = useCallback((incoming: { nodes: GraphNode[]; links: GraphLink[] }) => {
		setDataset((currentDataset) => {
			const nodeMap = new Map(currentDataset.graphData.nodes.map((node) => [node.id, node]));
			for (const node of incoming.nodes) nodeMap.set(node.id, node);
			const mergedNodes = Array.from(nodeMap.values());
			const linkMap = new Map<string, GraphLink>();
			const addLink = (link: GraphLink) => {
				const source = getEndpointId(link.source);
				const target = getEndpointId(link.target);
				const key = source < target ? `${source}:${target}` : `${target}:${source}`;
				if (!linkMap.has(key)) linkMap.set(key, link);
			};
			for (const link of currentDataset.graphData.links) addLink(link);
			for (const link of incoming.links) addLink(link);
			const mergedLinks = Array.from(linkMap.values());

			// Rebuild Graphology graph for adjacency/data lookups (no FA2-specific attributes)
			const graph = new Graph({ multi: false, type: 'undirected', allowSelfLoops: false });
			const spread = 3000;
			for (const node of mergedNodes) {
				const prevX = currentDataset.graph.hasNode(node.id) ? (currentDataset.graph.getNodeAttribute(node.id, 'x') as number | undefined) : undefined;
				const prevY = currentDataset.graph.hasNode(node.id) ? (currentDataset.graph.getNodeAttribute(node.id, 'y') as number | undefined) : undefined;
				graph.addNode(node.id, {
					...node,
					x: prevX ?? (Math.random() - 0.5) * spread,
					y: prevY ?? (Math.random() - 0.5) * spread,
				});
			}
			for (const link of mergedLinks) {
				const src = getEndpointId(link.source);
				const tgt = getEndpointId(link.target);
				if (src !== tgt && graph.hasNode(src) && graph.hasNode(tgt) && !graph.hasEdge(src, tgt)) {
					graph.addEdge(src, tgt, link);
				}
			}

			return {
				...currentDataset,
				graph,
				graphData: { nodes: mergedNodes, links: mergedLinks },
				adjacency: createAdjacencyMap(mergedLinks),
				linksByNodeId: createLinksByNodeId(mergedLinks),
				nodeById: new Map(mergedNodes.map((node) => [node.id, node])),
			};
		});
	}, []);

	const loadInitialNodes = useCallback(async () => {
		setStatusMessage('Loading entire graph...');
		try {
			const response = await fetch('/api/graph/search?all=true');
			if (!response.ok) throw new Error('Initial load failed');
			const result = (await response.json()) as { visibleNodes: GraphNode[]; visibleLinks: GraphLink[]; visibleNodeIds: string[] };
			mergeGraphData({ nodes: result.visibleNodes, links: result.visibleLinks });
			setVisibleNodeIds(new Set(result.visibleNodeIds));
		} catch {
			setStatusMessage('Failed to load graph.');
		}
	}, [mergeGraphData]);

	// Trigger initial API load if localStorage/URL had no saved state
	useEffect(() => {
		// eslint-disable-next-line react-hooks/set-state-in-effect
		if (needsInitialLoad) loadInitialNodes();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []); // run once on mount; needsInitialLoad is stable from initial state

	// Persist state to localStorage
	useEffect(() => {
		if (typeof window === 'undefined') return;
		try {
			window.localStorage.setItem(
				VISIBLE_NODE_IDS_STORAGE_KEY,
				JSON.stringify({
					nodeIds: Array.from(visibleNodeIds),
					selectedNodeId: selectedNodeId ?? null,
					visitedNodeIds: Array.from(visitedNodeIds),
					savedAt: new Date().toISOString(),
				}),
			);
		} catch {}
	}, [visibleNodeIds, selectedNodeId, visitedNodeIds]);

	const handleNodeClick = useCallback(
		(node: GraphNode | undefined) => {
			if (!node) return;

			// Pin selected node (skip WASM lerp for this node while pinned)
			if (selectedNodeId) {
				const prev = dataset.nodeById.get(selectedNodeId);
				if (prev) {
					prev.fx = undefined;
					prev.fy = undefined;
				}
			}
			node.fx = node.x;
			node.fy = node.y;

			setRecentlyRevealedNodeIds(new Set());
			setSelectedNodeId(node.id);
			setVisitedNodeIds((prev) => new Set(prev).add(node.id));
			setMenuOpen(true);
			setShowInfo(true);

			// 3-hop expansion for individuals, direct for firms
			if (node.kind === 'individual') {
				const adj = dataset.adjacency;
				let currentLayer = [node.id];
				const visited = new Set([node.id]);
				for (let i = 0; i < CLICK_REVEAL_HOPS; i++) {
					const nextLayer: string[] = [];
					for (const id of currentLayer) {
						for (const neighbor of adj.get(id) ?? []) {
							if (!visited.has(neighbor)) {
								visited.add(neighbor);
								nextLayer.push(neighbor);
							}
						}
					}
					currentLayer = nextLayer;
				}
				setVisibleNodeIds((prev) => {
					const next = new Set(prev);
					visited.forEach((id) => next.add(id));
					return next;
				});
				setRecentlyRevealedNodeIds(visited);
				setTimeout(() => setRecentlyRevealedNodeIds(new Set()), CLICK_REVEAL_HIGHLIGHT_MS);
			} else {
				const neighbors = dataset.adjacency.get(node.id) ?? [];
				setVisibleNodeIds((prev) => {
					const next = new Set(prev);
					next.add(node.id);
					neighbors.forEach((id) => next.add(id));
					return next;
				});
			}
		},
		[dataset, selectedNodeId],
	);

	const handleBackgroundClick = useCallback(() => {
		if (selectedNodeId) {
			const node = dataset.nodeById.get(selectedNodeId);
			if (node) {
				node.fx = undefined;
				node.fy = undefined;
			}
		}
		setSelectedNodeId(null);
		setHoveredNodeId(null);
	}, [dataset, selectedNodeId]);

	const handleSearchSubmit = useCallback(
		async (event: FormEvent<HTMLFormElement>) => {
			event.preventDefault();
			const query = searchQuery.trim();
			if (!query) return;
			try {
				const response = await fetch(`/api/graph/search?q=${encodeURIComponent(query)}`);
				const result = (await response.json()) as { visibleNodes: GraphNode[]; visibleLinks: GraphLink[]; visibleNodeIds: string[]; primaryMatchId?: string };
				mergeGraphData({ nodes: result.visibleNodes, links: result.visibleLinks });
				setVisibleNodeIds(new Set(result.visibleNodeIds));
				if (result.primaryMatchId) setSelectedNodeId(result.primaryMatchId);
			} catch {}
		},
		[mergeGraphData, searchQuery],
	);

	const lastDragNodeIdRef = useRef<string | null>(null);

	const onNodeDrag = useCallback(
		(node: GraphNode) => {
			if (lastDragNodeIdRef.current !== node.id) {
				lastDragNodeIdRef.current = node.id;
				const neighborIds = dataset.adjacency.get(node.id) ?? new Set<string>();
				const children: typeof dragChildOffsetsRef.current = [];
				neighborIds.forEach((id) => {
					const neighborNode = visibleGraph.nodes.find((n) => n.id === id);
					if (neighborNode && neighborNode !== node) {
						children.push({
							node: neighborNode as GraphNode & NodeObject,
							dx: (neighborNode.x ?? 0) - (node.x ?? 0),
							dy: (neighborNode.y ?? 0) - (node.y ?? 0),
						});
					}
				});
				dragChildOffsetsRef.current = children;
			}
			dragChildOffsetsRef.current.forEach((child) => {
				child.node.fx = (node.x ?? 0) + child.dx;
				child.node.fy = (node.y ?? 0) + child.dy;
			});
		},
		[dataset, visibleGraph.nodes],
	);

	const onNodeDragEnd = useCallback(() => {
		dragChildOffsetsRef.current.forEach((child) => {
			child.node.fx = undefined;
			child.node.fy = undefined;
		});
		dragChildOffsetsRef.current = [];
		lastDragNodeIdRef.current = null;
		wasmSimRef.current?.reheat?.();
	}, []);

	const handleLoadAllNodes = useCallback(async () => {
		try {
			const response = await fetch('/api/graph/search?count=5000');
			const result = (await response.json()) as { visibleNodes: GraphNode[]; visibleLinks: GraphLink[]; visibleNodeIds: string[] };
			mergeGraphData({ nodes: result.visibleNodes, links: result.visibleLinks });
			setVisibleNodeIds(new Set(result.visibleNodeIds));
		} catch {}
	}, [mergeGraphData]);

	const handleResetSession = useCallback(() => {
		setVisibleNodeIds(new Set());
		setSelectedNodeId(null);
		if (typeof window !== 'undefined') window.localStorage.removeItem(VISIBLE_NODE_IDS_STORAGE_KEY);
		setSearchQuery('');
	}, []);

	// Step WASM sim each frame and lerp node positions toward sim output.
	// Mutates node objects in-place — intentional react-force-graph-2d pattern.
	/* eslint-disable react-hooks/immutability */
	const onEngineTickFn = useCallback(() => {
		const sim = wasmSimRef.current;
		if (!sim) return;
		sim.step();
		const positions: Float32Array = sim.get_positions();
		const indexMap = nodeIndexMapRef.current;
		const LERP = 0.08;
		for (const node of visibleGraph.nodes) {
			if (node.fx !== undefined && node.fx !== null) continue;
			const idx = indexMap.get(node.id);
			if (idx === undefined) continue;
			const tx = positions[idx * 2];
			const ty = positions[idx * 2 + 1];
			node.x = (node.x ?? tx) + (tx - (node.x ?? tx)) * LERP;
			node.y = (node.y ?? ty) + (ty - (node.y ?? ty)) * LERP;
		}
	}, [visibleGraph.nodes]);
	/* eslint-enable react-hooks/immutability */

	return (
		<div
			className='h-screen w-screen overflow-hidden text-slate-100'
			style={{ background: dataset.visual.backgroundColor }}>
			<header className='absolute inset-x-0 top-0 z-30 border-b border-white/10 bg-slate-950/85 backdrop-blur-xl'>
				<div className='flex flex-wrap items-center justify-between gap-4 px-4 py-4 lg:px-6'>
					<div className='flex flex-1 flex-wrap items-center gap-4'>
						<h1 className='text-2xl font-semibold tracking-[0.24em] text-white'>FINRA</h1>
						<form
							className='flex min-w-70 flex-1 flex-wrap items-center gap-2'
							onSubmit={handleSearchSubmit}>
							<div className='min-w-55 flex-1 rounded-xl border border-white/10 bg-white/5 px-3 py-2 shadow-inner shadow-slate-950/40'>
								<input
									className='w-full bg-transparent text-sm text-slate-100 outline-none placeholder:text-slate-400'
									placeholder='firm, person, CRD/SEC#'
									value={searchQuery}
									onChange={(e) => setSearchQuery(e.target.value)}
								/>
							</div>
							<button
								className='rounded-xl bg-sky-400 px-4 py-2 text-sm font-medium text-slate-950 transition hover:bg-sky-300'
								type='submit'>
								Fetch Nodes
							</button>
							<button
								className='rounded-xl bg-transparent px-3 py-2 text-sm font-medium text-slate-100/80 hover:text-white transition border border-white/10'
								type='button'
								onClick={() => setVisitedNodeIds(new Set())}>
								Clear visited
							</button>
							{statusMessage && <span className='text-sm text-slate-300'>{statusMessage}</span>}
						</form>
					</div>
					<div className='flex items-center gap-3'>
						<button
							className='rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-slate-200 transition hover:bg-white/10'
							onClick={() => setMenuOpen(!menuOpen)}
							type='button'>
							Toggle menu
						</button>
					</div>
				</div>
			</header>

			<div className='flex h-full pt-22'>
				{menuOpen && (
					<aside
						className='z-20 flex h-full w-90 shrink-0 flex-col overflow-y-auto border-r px-4 py-4 lg:px-5'
						style={{ background: dataset.visual.panelBackground, borderColor: dataset.visual.panelBorder }}>
						<div className='grid grid-cols-4 gap-2'>
							<button
								className='rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-medium text-slate-200'
								onClick={() => setPanelPinned(!panelPinned)}
								type='button'>
								{panelPinned ? 'Unpin' : 'Pin'} panel
							</button>
							<button
								className='rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-medium text-slate-200'
								onClick={() => graphRef.current?.zoomToFit(500)}
								type='button'>
								Center
							</button>
							<button
								className='rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-medium text-slate-200'
								onClick={() => wasmSimRef.current?.reheat?.()}
								type='button'>
								Refresh
							</button>
						</div>
						<button
							className='mt-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-medium text-slate-200'
							onClick={handleLoadAllNodes}
							type='button'>
							Load 5,000 nodes
						</button>

						<div className='mt-4 flex flex-wrap gap-2'>
							<button
								className={`rounded-full px-3 py-1.5 text-xs font-medium ${traceMode ? 'bg-sky-400 text-slate-950' : 'border border-white/10 bg-white/5 text-slate-200'}`}
								onClick={() => setTraceMode(!traceMode)}
								type='button'>
								Trace Mode
							</button>
							<button
								className='rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-slate-200'
								onClick={handleBackgroundClick}
								type='button'>
								Clear Highlight
							</button>
							<button
								className='rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-slate-200'
								onClick={handleResetSession}
								type='button'>
								Reset Session
							</button>
							<button
								className='rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-slate-200'
								onClick={() => setShowLegend(!showLegend)}
								type='button'>
								Legend
							</button>
						</div>

						{showLegend && (
							<div className='mt-4 rounded-2xl border border-white/10 bg-white/5 p-4'>
								{dataset.legend.map((entry) => (
									<div
										className='flex items-start gap-3 py-1'
										key={entry.label}>
										<span
											className='mt-1 h-3 w-3 rounded-full'
											style={{ backgroundColor: entry.color }}
										/>
										<div>
											<div className='text-sm font-medium text-white'>{entry.label}</div>
											<div className='text-xs text-slate-400'>{entry.description}</div>
										</div>
									</div>
								))}
							</div>
						)}

						<div className='mt-5 rounded-3xl border border-white/10 bg-white/5 p-4 shadow-2xl shadow-slate-950/35'>
							{activeNode ?
								<>
									<div className='flex items-center gap-2 text-sm text-slate-400'>
										<span>{hoveredNodeId && hoveredNodeId !== selectedNodeId ? 'Preview:' : 'Selected:'}</span>
										<span className='font-semibold text-slate-100'>{activeNode.title}</span>
									</div>
									<div className='mt-1 text-sm text-slate-300'>{activeNode.identifierLine}</div>
									<div className='mt-3 flex flex-wrap gap-2'>
										{activeNode.badges.map((badge) => (
											<span
												className={getBadgeClassName(badge.tone)}
												key={`${activeNode.id}-${badge.label}`}>
												{badge.label}
											</span>
										))}
									</div>
									<div className='mt-4 flex gap-3 rounded-2xl bg-slate-950/40 p-3'>
										<div className='flex h-10 w-10 items-center justify-center rounded-2xl bg-sky-400/15 text-lg font-semibold text-sky-200'>{activeNode.marker}</div>
										<div>
											<div className='text-sm text-slate-200'>{activeNode.summary}</div>
											<div className='mt-1 text-xs uppercase tracking-[0.22em] text-slate-500'>{getKindLabel(activeNode.kind)}</div>
										</div>
									</div>
									<div className='mt-4 flex flex-wrap gap-2 items-center'>
										<button
											className='rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-white'
											onClick={() => setShowInfo(!showInfo)}
											type='button'>
											Info {showInfo ? '▾' : '▸'}
										</button>
										<button
											className='rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-white'
											onClick={() => setShowLog(!showLog)}
											type='button'>
											Log {showLog ? '▾' : '▸'}
										</button>
									</div>
									{showInfo && (
										<div className='mt-4 space-y-4'>
											{activeNode.externalLinks.map((link) => (
												<a
													key={link.href}
													className='rounded-full border border-sky-300/20 bg-sky-400/10 px-3 py-1 text-xs font-medium text-sky-200'
													href={link.href}
													target='_blank'
													rel='noreferrer'>
													↗ {link.label}
												</a>
											))}
											{activeNode.detailSections.map((section) => (
												<div
													className='rounded-2xl border border-white/10 bg-slate-950/35 p-4'
													key={section.title}>
													<div className='mb-2 text-sm font-semibold text-white'>{section.title}</div>
													{section.items?.map((item) => (
														<div
															className='grid grid-cols-[120px_1fr] gap-3 py-1 text-sm'
															key={item.label}>
															<div className='text-slate-400'>{item.label}</div>
															<div className='text-slate-100'>{item.value}</div>
														</div>
													))}
												</div>
											))}
										</div>
									)}
								</>
							:	<div className='text-sm text-slate-300'>Search or select a node to view details.</div>}
						</div>
					</aside>
				)}

				<main className='relative flex-1'>
					{ForceGraph2D && (
						<ForceGraph2D
							ref={graphRef}
							graphData={layeredGraph}
							backgroundColor={dataset.visual.backgroundColor}
							nodeRelSize={NODE_REL_SIZE}
							nodeVal={(node: GraphNode) => node.size ?? 5}
							nodeCanvasObject={(node: GraphNode, ctx: CanvasRenderingContext2D, globalScale: number) => {
								const r = Math.sqrt((node.size ?? 5) * NODE_REL_SIZE);
								const nx = node.x ?? 0;
								const ny = node.y ?? 0;
								const isInactive = isNodeInactive(node);
								const isSelected = selectedNodeId === node.id;
								const isRecently = recentlyRevealedNodeIds.has(node.id);
								const isHighlighted = highlightedNodeIds.has(node.id);
								const isHub = node.isHub;

								// Layer 3: selected/highlighted — glowing halo drawn beneath the node
								if (isSelected) {
									const haloR = r + 5;
									const grad = ctx.createRadialGradient(nx, ny, r * 0.5, nx, ny, haloR + 4);
									grad.addColorStop(0, 'rgba(255,255,255,0.35)');
									grad.addColorStop(1, 'rgba(255,255,255,0)');
									ctx.beginPath();
									ctx.arc(nx, ny, haloR + 4, 0, Math.PI * 2);
									ctx.fillStyle = grad;
									ctx.fill();
								} else if (isHighlighted) {
									ctx.beginPath();
									ctx.arc(nx, ny, r + 3, 0, Math.PI * 2);
									ctx.strokeStyle = 'rgba(255,255,255,0.45)';
									ctx.lineWidth = 1.5;
									ctx.stroke();
								} else if (isHub && !isInactive) {
									// Layer 2: hub ring
									ctx.beginPath();
									ctx.arc(nx, ny, r + 2, 0, Math.PI * 2);
									ctx.strokeStyle = 'rgba(255,200,60,0.4)';
									ctx.lineWidth = 1;
									ctx.stroke();
								}

								let color: string;
								if (isSelected) color = dataset.visual.activeNodeColor;
								else if (isRecently) color = dataset.visual.activeLinkColor;
								else if (isHighlighted) color = dataset.visual.neighborNodeColor;
								else if (isInactive)
									color = '#4b5563'; // layer 1 — muted gray
								else if (isHub)
									color = '#fbbf24'; // layer 2 hub — amber
								else color = dataset.visual.nodeColors[node.kind] ?? '#fff';

								const drawFn = node.kind === 'firm' ? drawFirmNode : drawPersonNode;
								drawFn(ctx, nx, ny, r, color, isInactive, node.hasDisclosure ?? false);

								// Labels visible per layer: selected always, hubs at zoom≥2, others at zoom≥3
								const labelThreshold = isSelected || isHub ? 2 : 3;
								if (globalScale >= labelThreshold) {
									const fontSize = Math.max(8 / globalScale, 2);
									ctx.font = `${isSelected || isHub ? 'bold ' : ''}${fontSize}px Sans-Serif`;
									ctx.textAlign = 'center';
									ctx.textBaseline = 'top';
									ctx.globalAlpha = isInactive ? 0.4 : 1;
									ctx.fillStyle = dataset.visual.nodeLabelColor;
									ctx.fillText(node.label, nx, ny + r + 1 / globalScale);
									ctx.globalAlpha = 1;
								}
							}}
							nodeCanvasObjectMode={() => 'replace'}
							nodePointerAreaPaint={(node: GraphNode, color: string, ctx: CanvasRenderingContext2D) => {
								const r = Math.sqrt((node.size ?? 5) * NODE_REL_SIZE) + 3;
								ctx.fillStyle = color;
								ctx.beginPath();
								ctx.arc(node.x ?? 0, node.y ?? 0, r, 0, Math.PI * 2);
								ctx.fill();
							}}
							nodeLabel='label'
							linkWidth={(link: GraphLink) => (highlightedLinkIds.has(getLinkKey(link)) ? 2.5 : 0.8)}
							linkColor={(link: GraphLink) => {
								if (highlightedLinkIds.has(getLinkKey(link))) return 'rgba(255,255,255,0.9)';
								switch (link.relationship) {
									case 'employment':
										return 'rgba(33,150,243,0.35)';
									case 'disclosure':
										return 'rgba(255,255,255,0.2)';
									case 'control':
										return 'rgba(244,67,54,0.5)';
									default:
										return 'rgba(255,255,255,0.15)';
								}
							}}
							linkDirectionalArrowLength={(link: GraphLink) => (link.relationship === 'control' ? 6 : 0)}
							linkDirectionalArrowRelPos={1}
							onEngineTick={onEngineTickFn}
							onNodeClick={handleNodeClick}
							onNodeHover={(node: GraphNode | null) => setHoveredNodeId(node?.id ?? null)}
							onBackgroundClick={handleBackgroundClick}
							onNodeDrag={onNodeDrag}
							onNodeDragEnd={onNodeDragEnd}
							enableNodeDrag
							d3AlphaDecay={0}
							d3VelocityDecay={1}
						/>
					)}
					<div className='absolute bottom-5 left-1/2 -translate-x-1/2 rounded-full border border-white/10 bg-slate-950/80 px-5 py-2 text-sm text-slate-200'>
						Displayed: {displayedStats.people} People · {displayedStats.firms} Firms · {displayedStats.links} Links
					</div>
				</main>
			</div>
		</div>
	);
}

function getBadgeClassName(tone: BadgeTone): string {
	switch (tone) {
		case 'success':
			return 'rounded-full bg-emerald-400/15 px-3 py-1 text-xs font-medium text-emerald-200';
		case 'warning':
			return 'rounded-full bg-amber-400/15 px-3 py-1 text-xs font-medium text-amber-200';
		case 'danger':
			return 'rounded-full bg-rose-400/15 px-3 py-1 text-xs font-medium text-rose-200';
		case 'info':
			return 'rounded-full bg-sky-400/15 px-3 py-1 text-xs font-medium text-sky-200';
		default:
			return 'rounded-full bg-slate-400/10 px-3 py-1 text-xs font-medium text-slate-200';
	}
}
