'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import type { ForceGraphMethods, NodeObject, LinkObject } from 'react-force-graph-3d';
import * as THREE from 'three';
import * as d3 from 'd3-force-3d';

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

// --- Constants & Config ---
const CLICK_REVEAL_HOPS = 3;
const CLICK_REVEAL_HIGHLIGHT_MS = 1100;
const SPREAD_FACTOR = 2.2;

export default function GraphView() {
	const router = useRouter();
	const pathname = usePathname();
	const [dataset, setDataset] = useState<GraphDataset>(() => createGraphDataset());
	const graphRef = useRef<ForceGraphMethods<GraphNode, GraphLink>>(null);
	const [ForceGraph3D, setForceGraph3D] = useState<any>(null);
	
	const [visibleNodeIds, setVisibleNodeIds] = useState<Set<string>>(() => new Set());
	const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
	const [visitedNodeIds, setVisitedNodeIds] = useState<Set<string>>(() => new Set());
	const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
	const [recentlyRevealedNodeIds, setRecentlyRevealedNodeIds] = useState<Set<string>>(() => new Set());
	const [searchQuery, setSearchQuery] = useState('');
	const [statusMessage, setStatusMessage] = useState('Ready. Search a name like “thornton” to display the graph.');
	const [selectionLog, setSelectionLog] = useState<string[]>(['Graph ready. Search for a firm or person to load nodes.']);
	const [showInfo, setShowInfo] = useState(true);
	const [showLog, setShowLog] = useState(false);
	const [traceMode, setTraceMode] = useState(false);
	const [showLegend, setShowLegend] = useState(false);
	const [menuOpen, setMenuOpen] = useState(true);
	const [panelPinned, setPanelPinned] = useState(true);

	const dragChildOffsetsRef = useRef<{ node: GraphNode & NodeObject; dx: number; dy: number; dz: number }[]>([]);

	const VISIBLE_NODE_IDS_STORAGE_KEY = 'graph-visible-node-ids-startup-leaders-v1';
	const VISIBLE_NODE_IDS_MAX_AGE_MS = 5 * 365 * 24 * 60 * 60 * 1000;

	const visibleGraph = useMemo(() => projectGraphData(dataset, visibleNodeIds), [dataset, visibleNodeIds]);
	const activeNodeId = hoveredNodeId ?? selectedNodeId;
	const activeNode = activeNodeId ? (dataset.nodeById.get(activeNodeId) ?? null) : null;
	const displayedStats = useMemo(() => getDisplayedStats(visibleGraph), [visibleGraph]);

	const highlightedNodeIds = useMemo(() => {
		if (!activeNodeId) return new Set<string>();
		if (traceMode && selectedNodeId) return expandSelection(dataset, selectedNodeId);
		return new Set([activeNodeId, ...(dataset.adjacency.get(activeNodeId) ?? new Set())]);
	}, [activeNodeId, dataset, selectedNodeId, traceMode]);

	const highlightedLinkIds = useMemo(() => {
		if (!activeNodeId) return new Set<string>();
		return new Set(
			visibleGraph.links
				.filter((link) => {
					const source = getEndpointId(link.source);
					const target = getEndpointId(link.target);
					return highlightedNodeIds.has(source) && highlightedNodeIds.has(target) && (traceMode || source === activeNodeId || target === activeNodeId);
				})
				.map((link) => getLinkKey(link)),
		);
	}, [activeNodeId, highlightedNodeIds, traceMode, visibleGraph.links]);

	// Load dynamic component
	useEffect(() => {
		import('react-force-graph-3d').then(m => setForceGraph3D(() => m.default));
	}, []);

	// Force simulation setup
	useEffect(() => {
		if (graphRef.current) {
			const fg = graphRef.current;
			fg.d3Force('charge')?.strength(-150); 
			fg.d3Force('link')?.distance(60);
			fg.d3Force('center')?.strength(0.05);
		}
	}, [ForceGraph3D]);

	const appendLog = useCallback((entry: string) => {
		setSelectionLog((currentEntries) => [entry, ...currentEntries].slice(0, 10));
	}, []);

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

			return {
				...currentDataset,
				graphData: { nodes: mergedNodes, links: mergedLinks },
				adjacency: createAdjacencyMap(mergedLinks),
				linksByNodeId: createLinksByNodeId(mergedLinks),
				nodeById: new Map(mergedNodes.map((node) => [node.id, node])),
			};
		});
	}, []);

	const loadInitialNodes = useCallback(async () => {
		setStatusMessage(`Loading entire graph...`);
		try {
			const response = await fetch(`/api/graph/search?all=true`);
			if (!response.ok) throw new Error(`Initial load failed`);
			const result = await response.json();
			mergeGraphData({ nodes: result.visibleNodes, links: result.visibleLinks });
			setVisibleNodeIds(new Set(result.visibleNodeIds));
		} catch (error) {
			setStatusMessage('Failed to load graph.');
		}
	}, [mergeGraphData]);

	// Initial data & storage restoration
	useEffect(() => {
		if (typeof window === 'undefined') return;

		const pathMatch = window.location.pathname.match(/^\/node\/([^/]+)$/);
		if (pathMatch) {
			const nodeId = pathMatch[1];
			const node = dataset.nodeById.get(nodeId);
			if (node) {
				setVisibleNodeIds(expandSelection(dataset, nodeId));
				setSelectedNodeId(nodeId);
				return;
			}
		}

		try {
			const raw = window.localStorage.getItem(VISIBLE_NODE_IDS_STORAGE_KEY);
			if (!raw) {
				loadInitialNodes();
				return;
			}
			const stored = JSON.parse(raw);
			if (!stored?.nodeIds?.length) {
				loadInitialNodes();
				return;
			}
			setVisibleNodeIds(new Set(stored.nodeIds));
			if (stored.selectedNodeId) setSelectedNodeId(stored.selectedNodeId);
			if (stored.visitedNodeIds?.length) setVisitedNodeIds(new Set(stored.visitedNodeIds));
		} catch {
			loadInitialNodes();
		}
	}, [dataset]);

	// Sync storage
	useEffect(() => {
		if (typeof window === 'undefined') return;
		try {
			window.localStorage.setItem(VISIBLE_NODE_IDS_STORAGE_KEY, JSON.stringify({
				nodeIds: Array.from(visibleNodeIds),
				selectedNodeId: selectedNodeId ?? null,
				visitedNodeIds: Array.from(visitedNodeIds),
				savedAt: new Date().toISOString(),
			}));
		} catch {}
	}, [visibleNodeIds, selectedNodeId, visitedNodeIds]);

	const handleNodeClick = useCallback(
		(node: GraphNode | undefined) => {
			if (!node) return;
			const typedNode = node;
			setRecentlyRevealedNodeIds(new Set());
			setSelectedNodeId(typedNode.id);
			setVisitedNodeIds((prev) => new Set(prev).add(typedNode.id));
			setMenuOpen(true);
			setShowInfo(true);

			// 3-hop expansion for individuals, direct for firms
			if (typedNode.kind === 'individual') {
				const adj = dataset.adjacency;
				let currentLayer = [typedNode.id];
				const visited = new Set([typedNode.id]);
				for (let i = 0; i < CLICK_REVEAL_HOPS; i++) {
					const nextLayer: string[] = [];
					for (const id of currentLayer) {
						for (const neighbor of adj.get(id) || []) {
							if (!visited.has(neighbor)) {
								visited.add(neighbor);
								nextLayer.push(neighbor);
							}
						}
					}
					currentLayer = nextLayer;
				}
				setVisibleNodeIds(prev => {
					const next = new Set(prev);
					visited.forEach(id => next.add(id));
					return next;
				});
				setRecentlyRevealedNodeIds(visited);
				setTimeout(() => setRecentlyRevealedNodeIds(new Set()), CLICK_REVEAL_HIGHLIGHT_MS);
			} else {
				const neighbors = dataset.adjacency.get(typedNode.id) || [];
				setVisibleNodeIds(prev => {
					const next = new Set(prev);
					next.add(typedNode.id);
					neighbors.forEach(id => next.add(id));
					return next;
				});
			}
		},
		[dataset],
	);

	const handleBackgroundClick = useCallback(() => {
		setSelectedNodeId(null);
		setHoveredNodeId(null);
	}, []);

	const handleSearchSubmit = useCallback(
		async (event: React.FormEvent<HTMLFormElement>) => {
			event.preventDefault();
			const query = searchQuery.trim();
			if (!query) return;

			try {
				const response = await fetch(`/api/graph/search?q=${encodeURIComponent(query)}`);
				const result = await response.json();
				mergeGraphData({ nodes: result.visibleNodes, links: result.visibleLinks });
				setVisibleNodeIds(new Set(result.visibleNodeIds));
				if (result.primaryMatchId) {
					setSelectedNodeId(result.primaryMatchId);
				}
			} catch (error) {}
		},
		[mergeGraphData, searchQuery],
	);

	// --- Dragging logic: Carry children ---
	const onNodeDragStart = useCallback((node: any) => {
		const neighborIds = dataset.adjacency.get(node.id) || new Set();
		const children: any[] = [];
		neighborIds.forEach(id => {
			const neighborNode = visibleGraph.nodes.find(n => n.id === id);
			if (neighborNode && neighborNode !== node) {
				children.push({
					node: neighborNode,
					dx: (neighborNode.x || 0) - (node.x || 0),
					dy: (neighborNode.y || 0) - (node.y || 0),
					dz: (neighborNode.z || 0) - (node.z || 0)
				});
			}
		});
		dragChildOffsetsRef.current = children;
	}, [dataset.adjacency, visibleGraph.nodes]);

	const onNodeDrag = useCallback((node: any) => {
		dragChildOffsetsRef.current.forEach(child => {
			child.node.fx = node.x + child.dx;
			child.node.fy = node.y + child.dy;
			child.node.fz = node.z + child.dz;
		});
	}, []);

	const onNodeDragEnd = useCallback((node: any) => {
		node.fx = node.x;
		node.fy = node.y;
		node.fz = node.z;
		dragChildOffsetsRef.current.forEach(child => {
			child.node.fx = child.node.x;
			child.node.fy = child.node.y;
			child.node.fz = child.node.z;
		});
		dragChildOffsetsRef.current = [];
		
		if (graphRef.current) graphRef.current.d3ReheatSimulation();
	}, []);

	const handleLoadAllNodes = useCallback(async () => {
		try {
			const response = await fetch('/api/graph/search?count=5000');
			const result = await response.json();
			mergeGraphData({ nodes: result.visibleNodes, links: result.visibleLinks });
			setVisibleNodeIds(new Set(result.visibleNodeIds));
		} catch (error) {}
	}, [mergeGraphData]);

	const handleResetSession = useCallback(() => {
		setVisibleNodeIds(new Set());
		setSelectedNodeId(null);
		if (typeof window !== 'undefined') window.localStorage.removeItem(VISIBLE_NODE_IDS_STORAGE_KEY);
		setSearchQuery('');
	}, []);

	return (
		<div className='h-screen w-screen overflow-hidden text-slate-100' style={{ background: dataset.visual.backgroundColor }}>
			<header className='absolute inset-x-0 top-0 z-30 border-b border-white/10 bg-slate-950/85 backdrop-blur-xl'>
				<div className='flex flex-wrap items-center justify-between gap-4 px-4 py-4 lg:px-6'>
					<div className='flex flex-1 flex-wrap items-center gap-4'>
						<h1 className='text-2xl font-semibold tracking-[0.24em] text-white'>FINRA</h1>
						<form className='flex min-w-70 flex-1 flex-wrap items-center gap-2' onSubmit={handleSearchSubmit}>
							<div className='min-w-55 flex-1 rounded-xl border border-white/10 bg-white/5 px-3 py-2 shadow-inner shadow-slate-950/40'>
								<input className='w-full bg-transparent text-sm text-slate-100 outline-none placeholder:text-slate-400' placeholder='firm, person, CRD/SEC#' value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
							</div>
							<button className='rounded-xl bg-sky-400 px-4 py-2 text-sm font-medium text-slate-950 transition hover:bg-sky-300' type='submit'>Fetch Nodes</button>
							<button className='rounded-xl bg-transparent px-3 py-2 text-sm font-medium text-slate-100/80 hover:text-white transition border border-white/10' type='button' onClick={() => setVisitedNodeIds(new Set())}>Clear visited</button>
							{statusMessage && <span className='text-sm text-slate-300'>{statusMessage}</span>}
						</form>
					</div>
					<div className='flex items-center gap-3'>
						<button className='rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-slate-200 transition hover:bg-white/10' onClick={() => setMenuOpen(!menuOpen)} type='button'>Toggle menu</button>
					</div>
				</div>
			</header>

			<div className='flex h-full pt-22'>
				{menuOpen && (
					<aside className='z-20 flex h-full w-90 shrink-0 flex-col overflow-y-auto border-r px-4 py-4 lg:px-5' style={{ background: dataset.visual.panelBackground, borderColor: dataset.visual.panelBorder }}>
						<div className='grid grid-cols-4 gap-2'>
							<button className='rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-medium text-slate-200' onClick={() => setPanelPinned(!panelPinned)} type='button'>{panelPinned ? 'Unpin' : 'Pin'} panel</button>
							<button className='rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-medium text-slate-200' onClick={() => graphRef.current?.zoomToFit(500)} type='button'>Center</button>
							<button className='rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-medium text-slate-200' onClick={() => graphRef.current?.d3ReheatSimulation()} type='button'>Refresh</button>
						</div>
						<button className='mt-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-medium text-slate-200' onClick={handleLoadAllNodes} type='button'>Load 5,000 nodes</button>

						<div className='mt-4 flex flex-wrap gap-2'>
							<button className={`rounded-full px-3 py-1.5 text-xs font-medium ${traceMode ? 'bg-sky-400 text-slate-950' : 'border border-white/10 bg-white/5 text-slate-200'}`} onClick={() => setTraceMode(!traceMode)} type='button'>Trace Mode</button>
							<button className='rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-slate-200' onClick={handleBackgroundClick} type='button'>Clear Highlight</button>
							<button className='rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-slate-200' onClick={handleResetSession} type='button'>Reset Session</button>
							<button className='rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-slate-200' onClick={() => setShowLegend(!showLegend)} type='button'>Legend</button>
						</div>

						{showLegend && (
							<div className='mt-4 rounded-2xl border border-white/10 bg-white/5 p-4'>
								{dataset.legend.map((entry) => (
									<div className='flex items-start gap-3 py-1' key={entry.label}>
										<span className='mt-1 h-3 w-3 rounded-full' style={{ backgroundColor: entry.color }} />
										<div>
											<div className='text-sm font-medium text-white'>{entry.label}</div>
											<div className='text-xs text-slate-400'>{entry.description}</div>
										</div>
									</div>
								))}
							</div>
						)}

						<div className='mt-5 rounded-3xl border border-white/10 bg-white/5 p-4 shadow-2xl shadow-slate-950/35'>
							{activeNode ? (
								<>
									<div className='flex items-center gap-2 text-sm text-slate-400'>
										<span>{hoveredNodeId && hoveredNodeId !== selectedNodeId ? 'Preview:' : 'Selected:'}</span>
										<span className='font-semibold text-slate-100'>{activeNode.title}</span>
									</div>
									<div className='mt-1 text-sm text-slate-300'>{activeNode.identifierLine}</div>
									<div className='mt-3 flex flex-wrap gap-2'>
										{activeNode.badges.map((badge) => (
											<span className={getBadgeClassName(badge.tone)} key={`${activeNode.id}-${badge.label}`}>{badge.label}</span>
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
										<button className='rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-white' onClick={() => setShowInfo(!showInfo)} type='button'>Info {showInfo ? '▾' : '▸'}</button>
										<button className='rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-white' onClick={() => setShowLog(!showLog)} type='button'>Log {showLog ? '▾' : '▸'}</button>
									</div>
									{showInfo && (
										<div className='mt-4 space-y-4'>
											{activeNode.externalLinks.map((link) => (
												<a key={link.href} className='rounded-full border border-sky-300/20 bg-sky-400/10 px-3 py-1 text-xs font-medium text-sky-200' href={link.href} target='_blank' rel='noreferrer'>↗ {link.label}</a>
											))}
											{activeNode.detailSections.map((section) => (
												<div className='rounded-2xl border border-white/10 bg-slate-950/35 p-4' key={section.title}>
													<div className='mb-2 text-sm font-semibold text-white'>{section.title}</div>
													{section.items?.map((item) => (
														<div className='grid grid-cols-[120px_1fr] gap-3 py-1 text-sm' key={item.label}>
															<div className='text-slate-400'>{item.label}</div>
															<div className='text-slate-100'>{item.value}</div>
														</div>
													))}
												</div>
											))}
										</div>
									)}
								</>
							) : <div className='text-sm text-slate-300'>Search or select a node to view details.</div>}
						</div>
					</aside>
				)}

				<main className='relative flex-1'>
					{ForceGraph3D && (
						<ForceGraph3D
							ref={graphRef}
							graphData={visibleGraph}
							backgroundColor={dataset.visual.backgroundColor}
							nodeRelSize={6}
							nodeColor={(node: any) => {
								const isSelected = selectedNodeId === node.id;
								const isRecently = recentlyRevealedNodeIds.has(node.id);
								const isHighlighted = highlightedNodeIds.has(node.id);
								const isVisited = visitedNodeIds.has(node.id);
								
								if (isSelected) return dataset.visual.activeNodeColor;
								if (isRecently) return dataset.visual.activeLinkColor;
								if (isHighlighted) return dataset.visual.neighborNodeColor;
								if (isVisited) return node.kind === 'firm' ? '#b45309' : '#1e40af';
								return (dataset.visual.nodeColors as any)[node.kind] || '#fff';
							}}
							nodeLabel="label"
							linkWidth={(link: any) => highlightedLinkIds.has(getLinkKey(link)) ? 2.5 : 1.0}
							linkColor={(link: any) => {
								if (highlightedLinkIds.has(getLinkKey(link))) return 'rgba(255, 255, 255, 0.9)';
								switch (link.relationship) {
									case 'employment': return 'rgba(0, 210, 255, 0.85)'; // Brighter Neon Blue
									case 'disclosure': return 'rgba(255, 255, 255, 0.35)'; // Faint Gray
									case 'control': return '#f44336'; // Vivid Red
									default: return 'rgba(255, 255, 255, 0.2)';
								}
							}}
							linkDirectionalArrowLength={(link: any) => link.relationship === 'control' ? 8 : 0}
							linkDirectionalArrowRelPos={1}
							onNodeClick={handleNodeClick}
							onNodeHover={(node: any) => setHoveredNodeId(node?.id || null)}
							onBackgroundClick={handleBackgroundClick}
							onNodeDragStart={onNodeDragStart}
							onNodeDrag={onNodeDrag}
							onNodeDragEnd={onNodeDragEnd}
							enableNodeDrag={true}
							d3AlphaDecay={0.01}
							d3VelocityDecay={0.3}
						/>
					)}
					<div className='absolute bottom-5 left-1/2 -translate-x-1/2 rounded-full border border-white/10 bg-slate-950/80 px-5 py-2 text-sm text-slate-200'>
						Displayed: {displayedStats.people} People {displayedStats.firms} Firms {displayedStats.links} Links
					</div>
				</main>
			</div>
		</div>
	);
}

function getBadgeClassName(tone: BadgeTone): string {
	switch (tone) {
		case 'success': return 'rounded-full bg-emerald-400/15 px-3 py-1 text-xs font-medium text-emerald-200';
		case 'warning': return 'rounded-full bg-amber-400/15 px-3 py-1 text-xs font-medium text-amber-200';
		case 'danger': return 'rounded-full bg-rose-400/15 px-3 py-1 text-xs font-medium text-rose-200';
		case 'info': return 'rounded-full bg-sky-400/15 px-3 py-1 text-xs font-medium text-sky-200';
		default: return 'rounded-full bg-slate-400/10 px-3 py-1 text-xs font-medium text-slate-200';
	}
}
