'use client';

import { forceCollide } from 'd3-force-3d';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import type { ForceGraphMethods, ForceGraphProps, LinkObject, NodeObject } from 'react-force-graph-2d';

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

type ForceGraphComponentType = React.ComponentType<any>;

type GraphMode = '2d' | '3d';

type ChargeForce = {
	strength: (strength: number | ((node: NodeObject<GraphNode>) => number)) => ChargeForce;
	distanceMax?: (distance: number) => ChargeForce;
};

type LinkForce = {
	distance: (distance: number | ((link: LinkObject<GraphNode, GraphLink>) => number)) => LinkForce;
	strength: (strength: number | ((link: LinkObject<GraphNode, GraphLink>) => number)) => LinkForce;
	iterations?: (iterations: number) => LinkForce;
};

type CollideForce = {
	radius: (radius: number | ((node: NodeObject<GraphNode>) => number)) => CollideForce;
	strength?: (strength: number) => CollideForce;
	iterations?: (iterations: number) => CollideForce;
};

type SimulatedGraphNode = NodeObject<GraphNode> & {
	size: number;
	degreeHint: number;
	isHub: boolean;
	x?: number;
	y?: number;
	z?: number;
	vx?: number;
	vy?: number;
	vz?: number;
};

type SimulationForce<NodeDatum> = ((alpha: number) => void) & {
	initialize?: (nodes: NodeDatum[]) => void;
};

const MIN_NODE_HIT_RADIUS_PX = 14;
const NODE_HIT_RADIUS_PADDING_PX = 6;
const MIN_NODE_LABEL_FONT_SIZE_PX = 3.5;
const NODE_LABEL_FONT_SIZE_PX = 10;
const NODE_LABEL_PADDING_PX = 4;
const MIN_LABEL_FONT_SIZE_WHEN_ZOOMED_OUT_PX = 20;
// Desired on-screen font size in pixels when labels should remain static on-screen
const STATIC_LABEL_ONSCREEN_PX = 20;
const STATIC_LABEL_PADDING_ONSCREEN_PX = 8;
const INITIAL_SEED_PEOPLE_COUNT = 7;
const INITIAL_SEED_FIRM_COUNT = 4;
const LARGE_GRAPH_RENDER_THRESHOLD = 1500;
const CLICK_REVEAL_HOPS = 3;
const CLICK_REVEAL_STEP_DELAY_MS = 320;
const CLICK_REVEAL_HIGHLIGHT_MS = 1100;

function createWeightedGravityForce(gravityStrength: number): SimulationForce<SimulatedGraphNode> {
	let nodes: SimulatedGraphNode[] = [];
	let maxNodeSize = 1;
	let maxDegreeHint = 1;

	const force = ((alpha: number) => {
		for (const node of nodes) {
			const normalizedSize = Math.max(0, (node.size ?? 0) / maxNodeSize);
			const normalizedDegree = Math.max(0, (node.degreeHint ?? 0) / maxDegreeHint);
			const nodeMass = normalizedSize * 0.65 + normalizedDegree * 0.35;
			if (nodeMass < 0.18 && !node.isHub) {
				continue;
			}

			const pullStrength = gravityStrength * Math.pow(nodeMass, 1.35) * (node.isHub ? 1.25 : 1) * alpha;
			node.vx = (node.vx ?? 0) - (node.x ?? 0) * pullStrength;
			node.vy = (node.vy ?? 0) - (node.y ?? 0) * pullStrength;

			if (typeof node.z === 'number') {
				node.vz = (node.vz ?? 0) - node.z * pullStrength;
			}
		}
	}) as SimulationForce<SimulatedGraphNode>;

	force.initialize = (nextNodes: SimulatedGraphNode[]) => {
		nodes = nextNodes;
		maxNodeSize = Math.max(1, ...nodes.map((node) => node.size ?? 0));
		maxDegreeHint = Math.max(1, ...nodes.map((node) => node.degreeHint ?? 0));
	};

	return force;
}

function traceNodeShapePath(ctx: CanvasRenderingContext2D, node: GraphNode, radius: number): void {
	if (node.kind === 'individual') {
		// draw a rotated square (diamond) so the top forms a pointed apex
		const cx = node.x ?? 0;
		const cy = node.y ?? 0;
		const size = radius * 2;
		ctx.save();
		ctx.translate(cx, cy);
		// rotate 45 degrees to give a triangular/top-pointed look
		ctx.rotate(Math.PI / 4);
		ctx.rect(-radius, -radius, size, size);
		ctx.restore();
		return;
	}

	if (node.kind !== 'firm') {
		ctx.arc(node.x ?? 0, node.y ?? 0, radius, 0, 2 * Math.PI, false);
		return;
	}

	for (let index = 0; index < 6; index += 1) {
		const angle = Math.PI / 6 + (index * Math.PI) / 3;
		const pointX = (node.x ?? 0) + Math.cos(angle) * radius;
		const pointY = (node.y ?? 0) + Math.sin(angle) * radius;
		if (index === 0) {
			ctx.moveTo(pointX, pointY);
		} else {
			ctx.lineTo(pointX, pointY);
		}
	}
	ctx.closePath();
}

function drawRoundedRect(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number): void {
	const clampedRadius = Math.min(radius, width / 2, height / 2);
	context.beginPath();
	context.moveTo(x + clampedRadius, y);
	context.lineTo(x + width - clampedRadius, y);
	context.quadraticCurveTo(x + width, y, x + width, y + clampedRadius);
	context.lineTo(x + width, y + height - clampedRadius);
	context.quadraticCurveTo(x + width, y + height, x + width - clampedRadius, y + height);
	context.lineTo(x + clampedRadius, y + height);
	context.quadraticCurveTo(x, y + height, x, y + height - clampedRadius);
	context.lineTo(x, y + clampedRadius);
	context.quadraticCurveTo(x, y, x + clampedRadius, y);
	context.closePath();
}

function createNodeLabelSprite(label: string, textColor: string, backgroundColor: string, accentColor: string, widthUnits: number, heightUnits: number): THREE.Sprite {
	const canvas = document.createElement('canvas');
	const context = canvas.getContext('2d');
	if (!context) {
		const fallback = new THREE.Sprite(new THREE.SpriteMaterial({ color: '#ffffff' }));
		fallback.scale.set(widthUnits, heightUnits, 1);
		return fallback;
	}

	const devicePixelRatio = 2;
	const fontSize = 42;
	context.font = `700 ${fontSize}px Inter, Arial, sans-serif`;
	const textWidth = Math.ceil(context.measureText(label).width);
	const horizontalPadding = 32;
	const verticalPadding = 18;
	const badgeWidth = Math.max(320, textWidth + horizontalPadding * 2);
	const badgeHeight = fontSize + verticalPadding * 2;
	canvas.width = badgeWidth * devicePixelRatio;
	canvas.height = badgeHeight * devicePixelRatio;
	context.scale(devicePixelRatio, devicePixelRatio);

	context.font = `700 ${fontSize}px Inter, Arial, sans-serif`;
	context.clearRect(0, 0, badgeWidth, badgeHeight);

	context.shadowColor = 'rgba(15, 23, 42, 0.45)';
	context.shadowBlur = 18;
	context.shadowOffsetY = 6;
	drawRoundedRect(context, 0, 0, badgeWidth, badgeHeight, 18);
	context.fillStyle = backgroundColor;
	context.fill();
	context.shadowColor = 'transparent';
	context.shadowBlur = 0;
	context.shadowOffsetY = 0;

	const gloss = context.createLinearGradient(0, 0, 0, badgeHeight);
	gloss.addColorStop(0, 'rgba(255, 255, 255, 0.20)');
	gloss.addColorStop(0.38, 'rgba(255, 255, 255, 0.06)');
	gloss.addColorStop(1, 'rgba(255, 255, 255, 0)');
	drawRoundedRect(context, 0, 0, badgeWidth, badgeHeight, 18);
	context.fillStyle = gloss;
	context.fill();

	context.lineWidth = 2;
	context.strokeStyle = 'rgba(255, 255, 255, 0.18)';
	drawRoundedRect(context, 1, 1, badgeWidth - 2, badgeHeight - 2, 17);
	context.stroke();

	context.fillStyle = accentColor;
	drawRoundedRect(context, 12, 10, 12, badgeHeight - 20, 6);
	context.fill();

	context.fillStyle = textColor;
	context.strokeStyle = 'rgba(2, 6, 23, 0.65)';
	context.lineWidth = 5;
	context.textAlign = 'center';
	context.textBaseline = 'middle';
	context.strokeText(label, badgeWidth / 2 + 8, badgeHeight / 2 + 1);
	context.fillText(label, badgeWidth / 2 + 8, badgeHeight / 2 + 1);

	const texture = new THREE.CanvasTexture(canvas);
	texture.needsUpdate = true;
	texture.colorSpace = THREE.SRGBColorSpace;
	const material = new THREE.SpriteMaterial({
		map: texture,
		transparent: true,
		depthWrite: false,
		depthTest: false,
	});
	const sprite = new THREE.Sprite(material);
	sprite.center.set(0.5, 0);
	sprite.scale.set(widthUnits, heightUnits, 1);
	return sprite;
}

function getNodeLabelMetrics(node: GraphNode, globalScale: number): { fontSize: number; labelY: number; labelPadding: number } {
	// Use a static on-screen font size so labels remain the same pixel size
	// regardless of zoom. Compute the canvas font size that results in the
	// desired on-screen pixels by dividing by the current globalScale.
	const desiredOnScreen = STATIC_LABEL_ONSCREEN_PX;
	const fontSize = globalScale > 0.0001 ? desiredOnScreen / globalScale : desiredOnScreen;

	// Padding should also be static on-screen pixels.
	const labelPadding = globalScale > 0.0001 ? STATIC_LABEL_PADDING_ONSCREEN_PX / globalScale : STATIC_LABEL_PADDING_ONSCREEN_PX;
	const labelY = (node.y ?? 0) - node.size - desiredOnScreen;

	return { fontSize, labelY, labelPadding };
}

function expandNodeHops(adjacency: Map<string, Set<string>>, startNodeId: string, maxHops: number): Set<string> {
	const visibleNodeIds = new Set<string>([startNodeId]);
	const queue: Array<{ nodeId: string; depth: number }> = [{ nodeId: startNodeId, depth: 0 }];

	while (queue.length > 0) {
		const current = queue.shift();
		if (!current) {
			continue;
		}

		if (current.depth >= maxHops) {
			continue;
		}

		for (const neighborId of adjacency.get(current.nodeId) ?? new Set<string>()) {
			if (visibleNodeIds.has(neighborId)) {
				continue;
			}

			visibleNodeIds.add(neighborId);
			queue.push({ nodeId: neighborId, depth: current.depth + 1 });
		}
	}

	return visibleNodeIds;
}

function getNodeHopLayers(adjacency: Map<string, Set<string>>, startNodeId: string, maxHops: number): string[][] {
	const visitedNodeIds = new Set<string>([startNodeId]);
	let frontierNodeIds = [startNodeId];
	const hopLayers: string[][] = [];

	for (let depth = 0; depth < maxHops; depth += 1) {
		const nextLayerNodeIds: string[] = [];

		for (const nodeId of frontierNodeIds) {
			for (const neighborId of adjacency.get(nodeId) ?? new Set<string>()) {
				if (visitedNodeIds.has(neighborId)) {
					continue;
				}

				visitedNodeIds.add(neighborId);
				nextLayerNodeIds.push(neighborId);
			}
		}

		if (nextLayerNodeIds.length === 0) {
			break;
		}

		hopLayers.push(nextLayerNodeIds);
		frontierNodeIds = nextLayerNodeIds;
	}

	return hopLayers;
}

function getCycleLinkIds(links: GraphLink[], nodeById: Map<string, GraphNode>): Set<string> {
	// Cycle highlighting is disabled — return empty set so no special purple styling is applied.
	return new Set<string>();
}

// Minimum canvas globalScale at which labels are shown in 2D. When zoomed out below this
// scale, labels are hidden to reduce clutter. Increase to hide labels earlier.
const LABEL_MIN_SCALE_FOR_LABELS = 0.55;

export default function GraphView() {
	const [dataset, setDataset] = useState<GraphDataset>(() => createGraphDataset());
	const graphRef = useRef<ForceGraphMethods<GraphNode, GraphLink> | undefined>(undefined);
	const skipNextAutoFitRef = useRef(false);
	const revealTimeoutIdsRef = useRef<Array<ReturnType<typeof setTimeout>>>([]);
	const revealHighlightTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const [forceGraph2D, setForceGraph2D] = useState<ForceGraphComponentType | null>(null);
	const [forceGraph3D, setForceGraph3D] = useState<ForceGraphComponentType | null>(null);
	const [graphMode, setGraphMode] = useState<GraphMode>('2d');
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

	const VISIBLE_NODE_IDS_STORAGE_KEY = 'graph-visible-node-ids-startup-leaders-v1';
	const VISIBLE_NODE_IDS_MAX_AGE_MS = 5 * 365 * 24 * 60 * 60 * 1000; // 5 years

	const visibleGraph = useMemo(() => projectGraphData(dataset, visibleNodeIds), [dataset, visibleNodeIds]);
	const selectedNode = selectedNodeId ? (dataset.nodeById.get(selectedNodeId) ?? null) : null;
	const activeNodeId = hoveredNodeId ?? selectedNodeId;
	const isLargeGraph = visibleGraph.nodes.length >= LARGE_GRAPH_RENDER_THRESHOLD;
	const activeNode = activeNodeId ? (dataset.nodeById.get(activeNodeId) ?? null) : null;
	const displayedStats = useMemo(() => getDisplayedStats(visibleGraph), [visibleGraph]);

	const highlightedNodeIds = useMemo(() => {
		if (!activeNodeId) {
			return new Set<string>();
		}

		if (traceMode && selectedNodeId) {
			return expandSelection(dataset, selectedNodeId);
		}

		return new Set([activeNodeId, ...(dataset.adjacency.get(activeNodeId) ?? new Set())]);
	}, [activeNodeId, dataset, selectedNodeId, traceMode]);

	const visibleNeighborCounts = useMemo(() => {
		const counts = new Map<string, number>();
		for (const link of visibleGraph.links) {
			const source = getEndpointId(link.source);
			const target = getEndpointId(link.target);
			counts.set(source, (counts.get(source) ?? 0) + 1);
			counts.set(target, (counts.get(target) ?? 0) + 1);
		}
		return counts;
	}, [visibleGraph.links]);

	const cycleLinkIds = useMemo(() => getCycleLinkIds(visibleGraph.links, dataset.nodeById), [dataset.nodeById, visibleGraph.links]);

	const appendLog = useCallback((entry: string) => {
		setSelectionLog((currentEntries) => [entry, ...currentEntries].slice(0, 10));
	}, []);

	const clearRevealTimers = useCallback(() => {
		for (const timeoutId of revealTimeoutIdsRef.current) {
			clearTimeout(timeoutId);
		}
		revealTimeoutIdsRef.current = [];

		if (revealHighlightTimeoutRef.current) {
			clearTimeout(revealHighlightTimeoutRef.current);
			revealHighlightTimeoutRef.current = null;
		}
	}, []);

	const mergeGraphData = useCallback((incoming: { nodes: GraphNode[]; links: GraphLink[] }) => {
		setDataset((currentDataset) => {
			const nodeMap = new Map(currentDataset.graphData.nodes.map((node) => [node.id, node]));
			for (const node of incoming.nodes) {
				nodeMap.set(node.id, node);
			}

			const mergedNodes = Array.from(nodeMap.values());
			const linkMap = new Map<string, GraphLink>();

			const addLink = (link: GraphLink) => {
				const source = getEndpointId(link.source);
				const target = getEndpointId(link.target);
				const key = source < target ? `${source}:${target}` : `${target}:${source}`;
				if (!linkMap.has(key)) {
					linkMap.set(key, link);
				}
			};

			for (const link of currentDataset.graphData.links) addLink(link);
			for (const link of incoming.links) addLink(link);

			const mergedLinks = Array.from(linkMap.values());

			return {
				...currentDataset,
				graphData: {
					nodes: mergedNodes,
					links: mergedLinks,
				},
				adjacency: createAdjacencyMap(mergedLinks),
				linksByNodeId: createLinksByNodeId(mergedLinks),
				nodeById: new Map(mergedNodes.map((node) => [node.id, node])),
			};
		});
	}, []);

	const hasDisclosureLinks = useCallback(
		(node: GraphNode) => dataset.linksByNodeId.get(node.id)?.some((link) => link.relationship === 'disclosure') ?? false,
		[dataset.linksByNodeId],
	);

	const highlightedLinkIds = useMemo(() => {
		if (!activeNodeId) {
			return new Set<string>();
		}

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

	useEffect(() => {
		return () => {
			clearRevealTimers();
		};
	}, [clearRevealTimers]);

	useEffect(() => {
		let isMounted = true;

		import('react-force-graph-2d').then((module) => {
			if (isMounted) {
				setForceGraph2D(() => module.default as ForceGraphComponentType);
			}
		});

		return () => {
			isMounted = false;
		};
	}, []);

	useEffect(() => {
		if (graphMode === '3d' && !forceGraph3D) {
			let isMounted = true;

			import('react-force-graph-3d').then((module) => {
				if (isMounted) {
					setForceGraph3D(() => module.default as ForceGraphComponentType);
				}
			});

			return () => {
				isMounted = false;
			};
		}
	}, [graphMode, forceGraph3D]);

	const loadInitialNodes = useCallback(async () => {
		clearRevealTimers();
		setRecentlyRevealedNodeIds(new Set());
		setStatusMessage(`Loading startup graph from the ${INITIAL_SEED_PEOPLE_COUNT} largest people and ${INITIAL_SEED_FIRM_COUNT} largest firms...`);
		try {
			const response = await fetch(`/api/graph/search?startup=leaders`);
			if (!response.ok) {
				throw new Error(`Initial load request failed with status ${response.status}`);
			}

			const result = (await response.json()) as {
				query: string;
				visibleNodeIds: string[];
				visibleNodes: GraphNode[];
				visibleLinks: GraphLink[];
				matchedNodeIds: string[];
				primaryMatchId: string | null;
				message: string;
			};

			mergeGraphData({ nodes: result.visibleNodes, links: result.visibleLinks });
			setVisibleNodeIds(new Set(result.visibleNodeIds));
			setSelectedNodeId(null);
			setShowInfo(true);
			setMenuOpen(true);
			setStatusMessage(result.message);
			appendLog(result.message);
			graphRef.current?.d3ReheatSimulation();
			graphRef.current?.zoomToFit(dataset.viewport.fitViewDurationMs, dataset.viewport.fitViewPadding);
		} catch (error) {
			setStatusMessage('Failed to load initial graph nodes. Search to display the graph.');
			appendLog(`Initial node load failed: ${String(error)}`);
		}
	}, [appendLog, clearRevealTimers, mergeGraphData, dataset.viewport.fitViewDurationMs, dataset.viewport.fitViewPadding]);

	useEffect(() => {
		if (typeof window === 'undefined') {
			return;
		}

		const pathMatch = window.location.pathname.match(/^\/node\/([^/]+)$/);
		if (pathMatch) {
			const nodeId = pathMatch[1];
			const node = dataset.nodeById.get(nodeId);
			if (node) {
				setVisibleNodeIds(expandSelection(dataset, nodeId));
				setSelectedNodeId(nodeId);
				setShowLegend(true);
				setMenuOpen(true);
				setStatusMessage(`Loaded ${node.title} from URL.`);
				appendLog(`Loaded ${nodeId} from URL and revealed its direct neighbors.`);
				return;
			}
		}

		try {
			const raw = window.localStorage.getItem(VISIBLE_NODE_IDS_STORAGE_KEY);
			if (!raw) {
				loadInitialNodes();
				return;
			}

			const stored = JSON.parse(raw) as { nodeIds: string[]; selectedNodeId?: string; visitedNodeIds?: string[]; savedAt?: string } | null;
			if (!stored?.nodeIds?.length) {
				loadInitialNodes();
				return;
			}

			const savedAt = stored.savedAt ? Date.parse(stored.savedAt) : NaN;
			const isRecent = Number.isFinite(savedAt) ? Date.now() - savedAt <= VISIBLE_NODE_IDS_MAX_AGE_MS : true;
			if (!isRecent) {
				loadInitialNodes();
				return;
			}

			setVisibleNodeIds(new Set(stored.nodeIds));
			setStatusMessage('Restored visible nodes from previous session.');
			appendLog('Restored visible nodes from local storage.');

			if (stored.selectedNodeId) {
				const node = dataset.nodeById.get(stored.selectedNodeId);
				if (node) {
					setSelectedNodeId(stored.selectedNodeId);
					setMenuOpen(true);
					setShowInfo(true);
					centerOnNode(stored.selectedNodeId, { reheat: true });
					appendLog(`Restored selected node ${stored.selectedNodeId} from local storage.`);
				}
			}
			if (stored.visitedNodeIds?.length) {
				setVisitedNodeIds(new Set(stored.visitedNodeIds));
				appendLog(`Restored ${stored.visitedNodeIds.length} visited nodes from local storage.`);
			}
			// If any of the stored node ids do not exist in our in-memory dataset, fetch the full dataset
			const missing = Array.from(stored.nodeIds).some((id) => !dataset.nodeById.has(id));
			if (missing) {
				(async () => {
					try {
						const resp = await fetch('/api/graph/search?all=true');
						if (resp.ok) {
							const result = await resp.json();
							mergeGraphData({ nodes: result.visibleNodes, links: result.visibleLinks });
							// ensure visible nodes are set after merging
							setVisibleNodeIds(new Set(stored.nodeIds));
							if (stored.selectedNodeId && dataset.nodeById.has(stored.selectedNodeId)) {
								setSelectedNodeId(stored.selectedNodeId);
								centerOnNode(stored.selectedNodeId, { reheat: true });
							}
							appendLog('Fetched full dataset to restore saved visible nodes.');
						}
					} catch (e) {
						// ignore fetch failures and continue
					}
				})();
			}
		} catch {
			// Ignore storage failures and continue with the empty graph.
			loadInitialNodes();
		}
	}, [appendLog, dataset, loadInitialNodes]);

	useEffect(() => {
		if (typeof window === 'undefined') {
			return;
		}

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
		} catch {
			// Ignore storage failures.
		}
	}, [visibleNodeIds, selectedNodeId, visitedNodeIds]);

	useEffect(() => {
		const graph = graphRef.current;
		if (!graph) {
			return;
		}

		const chargeForce = graph.d3Force('charge') as ChargeForce | undefined;
		chargeForce?.strength((node) => {
			const normalizedSize = Math.max((node.size ?? 0) / 54, 0.45);
			const hubBoost = node.isHub ? 1.3 : 1;
			return dataset.force.chargeStrength * (1 + normalizedSize * 0.55) * hubBoost;
		});
		chargeForce?.distanceMax?.(dataset.force.linkDistance * 10);

		const linkForce = graph.d3Force('link') as LinkForce | undefined;
		linkForce?.distance((link) => {
			const sourceNode = link.source as GraphNode | string;
			const targetNode = link.target as GraphNode | string;
			const sourceSize = typeof sourceNode === 'string' ? (dataset.nodeById.get(sourceNode)?.size ?? 0) : (sourceNode.size ?? 0);
			const targetSize = typeof targetNode === 'string' ? (dataset.nodeById.get(targetNode)?.size ?? 0) : (targetNode.size ?? 0);
			return dataset.force.linkDistance + ((link.weight ?? 1) - 1) * 12 + (sourceSize + targetSize) * 0.2;
		});
		linkForce?.strength((link) => dataset.force.linkStrength + ((link.weight ?? 1) - 1) * 0.04);
		linkForce?.iterations?.(2);

		const collideForce = forceCollide<NodeObject<GraphNode>>().radius((node) => Math.max(node.size * 1.15 + dataset.force.collisionPadding, 6));
		collideForce.strength?.(0.95);
		collideForce.iterations?.(isLargeGraph ? 1 : 3);
		graph.d3Force('collide', collideForce);
		graph.d3Force('weighted-gravity', createWeightedGravityForce(dataset.force.hubGravityStrength));

		if (skipNextAutoFitRef.current) {
			skipNextAutoFitRef.current = false;
			return;
		}

		graph.zoomToFit(dataset.viewport.fitViewDurationMs, dataset.viewport.fitViewPadding);
	}, [dataset, visibleGraph.links.length, visibleGraph.nodes.length]);

	const centerOnNode = useCallback(
		(nodeId: string | null, options?: { reheat?: boolean }) => {
			if (!nodeId || !graphRef.current) {
				return;
			}

			const node = dataset.nodeById.get(nodeId);
			if (!node) {
				return;
			}

			graphRef.current.centerAt(node.x ?? 0, node.y ?? 0, dataset.viewport.focusDurationMs);
			graphRef.current.zoom(dataset.force.focusZoom, dataset.viewport.focusDurationMs);

			if (options?.reheat && dataset.force.reheatOnSelect) {
				graphRef.current.d3ReheatSimulation();
			}
		},
		[dataset],
	);

	const handleNodeClick = useCallback(
		(node: NodeObject<GraphNode>) => {
			const typedNode = node as GraphNode;
			clearRevealTimers();
			skipNextAutoFitRef.current = true;
			setRecentlyRevealedNodeIds(new Set());
			setSelectedNodeId(typedNode.id);
			setVisitedNodeIds((prev) => {
				const next = new Set(prev);
				next.add(typedNode.id);
				return next;
			});
			setMenuOpen(true);
			setShowInfo(true);

			if (typedNode.kind === 'individual') {
				// Reveal up to CLICK_REVEAL_HOPS hops for a person node, but follow directed child edges only (source -> target)
				const directedChildren = new Map<string, Set<string>>();
				for (const link of dataset.graphData.links) {
					const src = getEndpointId(link.source);
					const tgt = getEndpointId(link.target);
					if (!directedChildren.has(src)) directedChildren.set(src, new Set());
					directedChildren.get(src)?.add(tgt);
				}
				const hopLayers: string[][] = [];
				let frontier = [typedNode.id];
				const visited = new Set<string>([typedNode.id]);
				for (let depth = 0; depth < CLICK_REVEAL_HOPS; depth += 1) {
					const nextLayer: string[] = [];
					for (const nid of frontier) {
						for (const childId of directedChildren.get(nid) ?? new Set()) {
							if (visited.has(childId)) continue;
							visited.add(childId);
							nextLayer.push(childId);
						}
					}
					if (nextLayer.length === 0) break;
					hopLayers.push(nextLayer);
					frontier = nextLayer;
				}
				const nodesToAdd = new Set<string>([typedNode.id]);
				hopLayers.forEach((layer) => layer.forEach((id) => nodesToAdd.add(id)));
				setVisibleNodeIds((current) => {
					const next = new Set(current);
					for (const id of nodesToAdd) next.add(id);
					return next;
				});
				const firstHop = hopLayers[0] ?? [];
				setRecentlyRevealedNodeIds(new Set(firstHop));
				graphRef.current?.d3ReheatSimulation();
				setStatusMessage(`Selected ${typedNode.title}. Revealed ${nodesToAdd.size - 1} connected nodes up to ${CLICK_REVEAL_HOPS} hops.`);
				appendLog(`Selected ${typedNode.title}. Revealed ${nodesToAdd.size - 1} nodes (up to ${CLICK_REVEAL_HOPS} hops).`);
				if (revealHighlightTimeoutRef.current) clearTimeout(revealHighlightTimeoutRef.current);
				revealHighlightTimeoutRef.current = setTimeout(() => {
					setRecentlyRevealedNodeIds(new Set());
					revealHighlightTimeoutRef.current = null;
				}, CLICK_REVEAL_HIGHLIGHT_MS);
				return;
			}

			if (typedNode.kind === 'firm') {
				// For firms, only show direct employees/buyers who have control positions (relationship 'control' or 'employment')
				const links = dataset.linksByNodeId.get(typedNode.id) ?? [];
				const matched = new Set<string>();
				for (const link of links) {
					if (!(link.relationship === 'control' || link.relationship === 'employment')) continue;
					const otherId = getEndpointId(link.source) === typedNode.id ? getEndpointId(link.target) : getEndpointId(link.source);
					const otherNode = dataset.nodeById.get(otherId);
					if (otherNode && otherNode.kind === 'individual') matched.add(otherId);
				}
				setVisibleNodeIds((current) => {
					const next = new Set(current);
					next.add(typedNode.id);
					for (const id of matched) next.add(id);
					return next;
				});
				setRecentlyRevealedNodeIds(new Set(matched));
				graphRef.current?.d3ReheatSimulation();
				setStatusMessage(`Selected ${typedNode.title}. Showing ${matched.size} direct employees/controls.`);
				appendLog(`Selected ${typedNode.title}. Revealed ${matched.size} direct employees/controls.`);
				if (revealHighlightTimeoutRef.current) clearTimeout(revealHighlightTimeoutRef.current);
				revealHighlightTimeoutRef.current = setTimeout(() => {
					setRecentlyRevealedNodeIds(new Set());
					revealHighlightTimeoutRef.current = null;
				}, CLICK_REVEAL_HIGHLIGHT_MS);
				return;
			}

			// Fallback: reveal direct neighbors
			setVisibleNodeIds((currentVisibleNodeIds) => {
				const nextVisibleNodeIds = new Set(currentVisibleNodeIds);
				nextVisibleNodeIds.add(typedNode.id);
				for (const neighborId of dataset.adjacency.get(typedNode.id) ?? []) {
					nextVisibleNodeIds.add(neighborId);
				}
				return nextVisibleNodeIds;
			});
			setStatusMessage(`Selected ${typedNode.title}. Revealed direct neighbors.`);
			appendLog(`Selected ${typedNode.title}. Revealed ${Array.from(dataset.adjacency.get(typedNode.id) ?? []).length} neighbors.`);
			graphRef.current?.d3ReheatSimulation();
		},
		[appendLog, clearRevealTimers, dataset, centerOnNode],
	);

	const handleBackgroundClick = useCallback(() => {
		setSelectedNodeId(null);
		setHoveredNodeId(null);
		setStatusMessage('Highlight cleared.');
		graphRef.current?.zoomToFit(dataset.viewport.fitViewDurationMs, dataset.viewport.fitViewPadding);
	}, [dataset.viewport.fitViewDurationMs, dataset.viewport.fitViewPadding]);

	const handleGraphModeChange = useCallback(
		(nextMode: GraphMode) => {
			if (nextMode === graphMode) {
				return;
			}

			setGraphMode(nextMode);
			setStatusMessage(`Switched to ${nextMode === '2d' ? '2D' : '3D'} view.`);
			appendLog(`Switched graph rendering to ${nextMode === '2d' ? '2D' : '3D'} mode.`);
		},
		[appendLog, graphMode],
	);

	const handleSearchSubmit = useCallback(
		async (event: React.FormEvent<HTMLFormElement>) => {
			event.preventDefault();
			const query = searchQuery.trim();
			if (!query) {
				setStatusMessage('Enter a name, firm, or CRD/SEC# to expand the graph.');
				return;
			}

			setStatusMessage('Searching the full dataset...');
			clearRevealTimers();
			setRecentlyRevealedNodeIds(new Set());
			try {
				const response = await fetch(`/api/graph/search?q=${encodeURIComponent(query)}`);
				if (!response.ok) {
					throw new Error(`Search request failed with status ${response.status}`);
				}

				const result = (await response.json()) as {
					query: string;
					visibleNodeIds: string[];
					visibleNodes: GraphNode[];
					visibleLinks: GraphLink[];
					matchedNodeIds: string[];
					primaryMatchId: string | null;
					message: string;
				};

				mergeGraphData({ nodes: result.visibleNodes, links: result.visibleLinks });

				// Replace visible nodes with the fetched result so only the fetched node and its connections are shown
				setVisibleNodeIds(new Set(result.visibleNodeIds));

				setStatusMessage(result.message);

				if (result.primaryMatchId) {
					setSelectedNodeId(result.primaryMatchId);
					setMenuOpen(true);
					setShowInfo(true);
					graphRef.current?.d3ReheatSimulation();
					graphRef.current?.zoomToFit(dataset.viewport.fitViewDurationMs, dataset.viewport.fitViewPadding);
					centerOnNode(result.primaryMatchId);
					appendLog(`Searched “${result.query}” and surfaced ${result.matchedNodeIds.length} matching nodes.`);
				} else {
					appendLog(`Searched “${result.query}” and found no matching nodes.`);
				}
			} catch (error) {
				setStatusMessage('Full dataset search failed.');
				appendLog(`Search failed: ${String(error)}`);
			}
		},
		[appendLog, centerOnNode, clearRevealTimers, dataset, mergeGraphData, searchQuery],
	);

	const handleLoadAllNodes = useCallback(async () => {
		clearRevealTimers();
		setRecentlyRevealedNodeIds(new Set());
		setStatusMessage('Loading all nodes from full dataset...');
		try {
			const response = await fetch('/api/graph/search?all=true');
			if (!response.ok) {
				throw new Error(`Load all request failed with status ${response.status}`);
			}

			const result = (await response.json()) as {
				query: string;
				visibleNodeIds: string[];
				visibleNodes: GraphNode[];
				visibleLinks: GraphLink[];
				matchedNodeIds: string[];
				primaryMatchId: string | null;
				message: string;
			};

			mergeGraphData({ nodes: result.visibleNodes, links: result.visibleLinks });
			setVisibleNodeIds(new Set(result.visibleNodeIds));
			setSelectedNodeId(null);
			setStatusMessage(result.message);
			setMenuOpen(true);
			setShowInfo(true);
			appendLog(result.message);
			graphRef.current?.d3ReheatSimulation();
			graphRef.current?.zoomToFit(dataset.viewport.fitViewDurationMs, dataset.viewport.fitViewPadding);
		} catch (error) {
			setStatusMessage('Failed to load all nodes.');
			appendLog(`Load all nodes failed: ${String(error)}`);
		}
	}, [appendLog, clearRevealTimers, mergeGraphData]);

	const handleResetSession = useCallback(() => {
		clearRevealTimers();
		setVisibleNodeIds(new Set());
		setSelectedNodeId(null);
		setHoveredNodeId(null);
		setRecentlyRevealedNodeIds(new Set());
		if (typeof window !== 'undefined') {
			window.localStorage.removeItem(VISIBLE_NODE_IDS_STORAGE_KEY);
		}
		setTraceMode(false);
		setShowInfo(true);
		setShowLog(false);
		setSearchQuery('');
		setStatusMessage('Session reset. Search a name to display nodes again.');
		appendLog('Reset the local graph session.');
		graphRef.current?.zoomToFit(dataset.viewport.fitViewDurationMs, dataset.viewport.fitViewPadding);
	}, [appendLog, clearRevealTimers, dataset]);

	const getLinkNode = useCallback(
		(endpoint: string | GraphNode): GraphNode | null => {
			const nodeId = typeof endpoint === 'string' ? endpoint : endpoint.id;
			// Always resolve link endpoints to the canonical node stored in dataset.nodeById.
			// Returning the original endpoint object can lead to mismatched instances without position data.
			return dataset.nodeById.get(nodeId) ?? null;
		},
		[dataset.nodeById],
	);

	const getLinkTargetNode = useCallback((link: GraphLink): GraphNode | null => getLinkNode(link.target), [getLinkNode]);
	const getLinkSourceNode = useCallback((link: GraphLink): GraphNode | null => getLinkNode(link.source), [getLinkNode]);

	const isInactiveLink = useCallback(
		(link: GraphLink) => {
			const sourceNode = getLinkSourceNode(link);
			const targetNode = getLinkTargetNode(link);
			return (sourceNode ? isNodeInactive(sourceNode) : false) || (targetNode ? isNodeInactive(targetNode) : false);
		},
		[getLinkSourceNode, getLinkTargetNode],
	);

	const isPreviousLink = useCallback((link: GraphLink) => link.relationship === 'disclosure', []);
	const getLinkTypeColor = useCallback(
		(link: GraphLink) => {
			if (highlightedLinkIds.has(getLinkKey(link))) {
				return dataset.visual.activeLinkColor;
			}

			if (cycleLinkIds.has(getLinkKey(link))) {
				return dataset.visual.cycleLinkColor;
			}

			switch (link.relationship) {
				case 'employment':
					return '#38bdf8';
				case 'disclosure':
					return 'rgba(148, 163, 184, 0.92)';
				case 'control':
					return '#f87171';
				case 'peer':
					return '#facc15';
				default:
					return dataset.visual.linkColor;
			}
		},
		[cycleLinkIds, dataset.visual.activeLinkColor, dataset.visual.cycleLinkColor, dataset.visual.linkColor, highlightedLinkIds],
	);

	const createNodeThreeObject = useCallback(
		(node: GraphNode) => {
			const isSelected = selectedNodeId === node.id;
			const isVisited = visitedNodeIds.has(node.id);
			const isRecentlyRevealed = recentlyRevealedNodeIds.has(node.id);
			let nodeColor = isRecentlyRevealed ? dataset.visual.activeLinkColor : dataset.visual.nodeColors[node.kind];
			if (isVisited && !isSelected) {
				if (node.kind === 'firm') nodeColor = '#b45309';
				else if (node.kind === 'individual') nodeColor = '#1e40af';
			}
			if (isSelected) {
				if (node.kind === 'firm') nodeColor = '#b45309';
				else if (node.kind === 'individual') nodeColor = '#1e40af';
				else nodeColor = dataset.visual.activeNodeColor;
			}
			const baseRadius = Math.max(node.size * 0.5, 4.2);
			const geometry =
				node.kind === 'firm' ? new THREE.CylinderGeometry(baseRadius, baseRadius, Math.max(baseRadius * 0.45, 2.6), 6)
				: node.kind === 'individual' ? new THREE.BoxGeometry(baseRadius * 1.85, baseRadius * 1.85, baseRadius * 1.85)
				: new THREE.SphereGeometry(baseRadius, 18, 18);
			const material = new THREE.MeshBasicMaterial({
				color: nodeColor,
				transparent: true,
				opacity: isRecentlyRevealed ? 1 : 0.95,
			});
			const mesh = new THREE.Mesh(geometry, material);

			// rotate individuals so they appear as a diamond/triangular-top in 3D as well
			if (node.kind === 'individual') {
				mesh.rotation.z = Math.PI / 4;
			}

			// add a subtle black outline behind selected or visited nodes to simulate a pressed/visited border
			if (isSelected || (isVisited && !isSelected)) {
				try {
					const outlineGeom = geometry.clone();
					const outlineMat = new THREE.MeshBasicMaterial({ color: 'black' });
					const outlineMesh = new THREE.Mesh(outlineGeom, outlineMat);
					outlineMesh.scale.set(isSelected ? 1.12 : 1.08, isSelected ? 1.12 : 1.08, isSelected ? 1.12 : 1.08);
					outlineMesh.renderOrder = 0;
					mesh.renderOrder = 1;
					// group will add outline first so the colored mesh sits on top
					const group = new THREE.Group();
					group.add(outlineMesh);
					group.add(mesh);
					const labelOffsetY = node.kind === 'individual' ? baseRadius * 1.05 : baseRadius + 1.8;
					const labelSprite = createNodeLabelSprite(
						node.label,
						isSelected ? '#082f49' : dataset.visual.nodeLabelColor,
						isSelected ? 'rgba(248, 250, 252, 0.96)' : 'rgba(2, 6, 23, 0.84)',
						isSelected ? '#38bdf8' : nodeColor,
						Math.max(baseRadius * 4.6, 18),
						Math.max(baseRadius * 1.05, 4.8),
					);
					labelSprite.position.set(0, labelOffsetY, 0);
					group.add(labelSprite);
					return group;
				} catch {
					// fallback to regular mesh if clone or outline fails
				}
			}
			const labelOffsetY = node.kind === 'individual' ? baseRadius * 1.05 : baseRadius + 1.8;
			const labelSprite = createNodeLabelSprite(
				node.label,
				isSelected ? '#082f49' : dataset.visual.nodeLabelColor,
				isSelected ? 'rgba(248, 250, 252, 0.96)' : 'rgba(2, 6, 23, 0.84)',
				isSelected ? '#38bdf8' : nodeColor,
				Math.max(baseRadius * 4.6, 18),
				Math.max(baseRadius * 1.05, 4.8),
			);
			labelSprite.position.set(0, labelOffsetY, 0);

			const group = new THREE.Group();
			group.add(mesh);
			group.add(labelSprite);
			return group;
		},
		[dataset.visual, recentlyRevealedNodeIds, selectedNodeId, visitedNodeIds],
	);

	const handleReflow = useCallback(() => {
		graphRef.current?.d3ReheatSimulation();
		setStatusMessage('Layout reheated.');
		appendLog('Reflowed the visible layout.');
	}, [appendLog]);

	const renderLink = useCallback(
		(link: GraphLink, ctx: CanvasRenderingContext2D, globalScale: number) => {
			const source = getLinkNode(link.source);
			const target = getLinkNode(link.target);
			if (!source || !target) {
				return;
			}
			const isHighlighted = highlightedLinkIds.has(getLinkKey(link));
			const isCycleLink = cycleLinkIds.has(getLinkKey(link));
			const faded = traceMode && selectedNodeId && !isHighlighted;
			const disclosureLink = isPreviousLink(link);
			// Explicit color and dash rules: solid blue for current (employment), dashed gray for previous (disclosure)
			const linkColor = disclosureLink ? 'rgba(148,163,184,0.9)' : '#38bdf8';
			const dashed = disclosureLink;

			ctx.save();
			ctx.globalAlpha =
				faded ? 0.18
				: isHighlighted ? 1
				: isCycleLink ? 0.96
				: 1;
			ctx.strokeStyle = linkColor;
			ctx.lineWidth = Math.max(isHighlighted ? dataset.visual.activeLinkWidth : dataset.visual.linkWidth + ((link.weight ?? 1) - 1) * 0.25, 1.4);
			ctx.shadowBlur = isCycleLink ? 12 / globalScale : 0;
			ctx.shadowColor = isCycleLink ? dataset.visual.cycleLinkColor : 'transparent';
			ctx.setLineDash(dashed ? [6 / globalScale, 6 / globalScale] : []);
			ctx.beginPath();
			ctx.moveTo(source.x ?? 0, source.y ?? 0);
			ctx.lineTo(target.x ?? 0, target.y ?? 0);
			ctx.stroke();
			ctx.restore();
		},
		[
			cycleLinkIds,
			dataset.visual.cycleLinkColor,
			dataset.visual.cycleLinkWidth,
			dataset.visual.activeLinkWidth,
			dataset.visual.linkWidth,
			getLinkNode,
			getLinkTypeColor,
			highlightedLinkIds,
			isInactiveLink,
			isLargeGraph,
			isPreviousLink,
			selectedNodeId,
			traceMode,
		],
	);

	const renderNode = useCallback(
		(node: NodeObject<GraphNode>, ctx: CanvasRenderingContext2D, globalScale: number) => {
			const typedNode = node as GraphNode;
			const radius = typedNode.size;
			const isHighlighted = highlightedNodeIds.has(typedNode.id);
			const isRecentlyRevealed = recentlyRevealedNodeIds.has(typedNode.id);
			const faded = traceMode && selectedNodeId && !isHighlighted;
			const isSelected = selectedNodeId === typedNode.id;
			const isVisited = visitedNodeIds.has(typedNode.id);
			const baseColor = isHighlighted ? dataset.visual.neighborNodeColor : dataset.visual.nodeColors[typedNode.kind];
			const isLeaf = (visibleNeighborCounts.get(typedNode.id) ?? 0) === 0;
			const isSelectedOrLeaf = isSelected || isLeaf;
			// Selection / visited styling: selected wins, then visited, then recently revealed, then base
			let fillColor =
				isSelectedOrLeaf ? dataset.visual.activeNodeColor
				: isRecentlyRevealed ? dataset.visual.activeLinkColor
				: baseColor;
			if (isVisited && !isSelected) {
				if (typedNode.kind === 'firm') {
					fillColor = '#b45309';
				} else if (typedNode.kind === 'individual') {
					fillColor = '#1e40af';
				}
			}
			if (isSelected) {
				if (typedNode.kind === 'firm') fillColor = '#b45309';
				else if (typedNode.kind === 'individual') fillColor = '#1e40af';
			}

			if (isRecentlyRevealed) {
				ctx.beginPath();
				traceNodeShapePath(ctx, typedNode, radius + Math.max(3 / globalScale, 1.5));
				ctx.fillStyle = 'rgba(125, 211, 252, 0.26)';
				ctx.fill();
			}

			ctx.globalAlpha = faded ? 0.18 : 1;
			ctx.beginPath();
			traceNodeShapePath(ctx, typedNode, radius);
			ctx.fillStyle = fillColor;
			ctx.fill();

			if (isSelected) {
				ctx.lineWidth = 2.8;
			} else if (isVisited) {
				ctx.lineWidth = 2.2;
			} else {
				ctx.lineWidth = typedNode.isHub || isSelectedOrLeaf ? 2.8 : 1.1;
			}
			ctx.strokeStyle =
				isSelected || (isVisited && !isSelected) ? 'black'
				: typedNode.isHub || isSelectedOrLeaf ? dataset.visual.hubRingColor
				: dataset.visual.nodeStrokeColor;
			ctx.stroke();

			const { fontSize, labelY, labelPadding } = getNodeLabelMetrics(typedNode, globalScale);
			// Hide labels when zoomed far out (globalScale below threshold) to reduce clutter,
			// but always show labels for selected or visited nodes so the user can follow their pressed nodes.
			const forceShow = visitedNodeIds.has(typedNode.id) || selectedNodeId === typedNode.id;
			const showLabel =
				(forceShow || globalScale >= LABEL_MIN_SCALE_FOR_LABELS) &&
				(!isLargeGraph || selectedNodeId === typedNode.id || highlightedNodeIds.has(typedNode.id) || isLeaf || isRecentlyRevealed);
			if (showLabel) {
				ctx.font = `${fontSize}px Inter, sans-serif`;
				ctx.textAlign = 'center';
				ctx.textBaseline = 'middle';

				const labelWidth = ctx.measureText(typedNode.label).width;
				const labelBoxWidth = labelWidth + labelPadding * 2;
				const labelBoxHeight = fontSize + labelPadding * 1.5;
				const labelBoxX = (typedNode.x ?? 0) - labelBoxWidth / 2;
				const labelBoxY = labelY - labelBoxHeight / 2;

				ctx.fillStyle = faded ? 'rgba(2, 6, 23, 0.32)' : 'rgba(2, 6, 23, 0.72)';
				ctx.fillRect(labelBoxX, labelBoxY, labelBoxWidth, labelBoxHeight);

				ctx.fillStyle = selectedNodeId === typedNode.id ? dataset.visual.activeLinkColor : dataset.visual.nodeLabelColor;
				ctx.fillText(typedNode.label, typedNode.x ?? 0, labelY);
			}

			ctx.globalAlpha = 1;
		},
		[dataset.visual, highlightedNodeIds, isLargeGraph, recentlyRevealedNodeIds, selectedNodeId, traceMode, visibleNeighborCounts, visitedNodeIds],
	);

	const renderNodePointerArea = useCallback(
		(node: NodeObject<GraphNode>, color: string, ctx: CanvasRenderingContext2D, globalScale: number) => {
			const typedNode = node as GraphNode;
			const minimumRadius = MIN_NODE_HIT_RADIUS_PX / globalScale;
			const paddingRadius = NODE_HIT_RADIUS_PADDING_PX / globalScale;
			const hitRadius = Math.max(typedNode.size + paddingRadius, minimumRadius);
			const shouldIncludeLabelHitArea = typedNode.id === selectedNodeId || typedNode.id === hoveredNodeId;

			ctx.beginPath();
			traceNodeShapePath(ctx, typedNode, hitRadius);
			ctx.fillStyle = color;
			ctx.fill();

			if (!shouldIncludeLabelHitArea) {
				return;
			}

			const { fontSize, labelY, labelPadding } = getNodeLabelMetrics(typedNode, globalScale);
			ctx.font = `${fontSize}px Inter, sans-serif`;
			const labelWidth = ctx.measureText(typedNode.label).width;
			const labelBoxWidth = labelWidth + labelPadding * 2;
			const labelBoxHeight = fontSize + labelPadding * 1.5;

			ctx.fillRect((typedNode.x ?? 0) - labelBoxWidth / 2, labelY - labelBoxHeight / 2, labelBoxWidth, labelBoxHeight);
		},
		[hoveredNodeId, selectedNodeId],
	);

	const ForceGraphCanvas = graphMode === '2d' ? forceGraph2D : forceGraph3D;

	if (!ForceGraphCanvas) {
		return <div className='flex h-screen items-center justify-center bg-slate-950 text-white'>Loading {graphMode === '3d' ? '3D' : '2D'} force-directed graph...</div>;
	}

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
									onChange={(event) => setSearchQuery(event.target.value)}
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
								onClick={() => {
									setVisitedNodeIds(new Set());
									appendLog('Cleared visited nodes.');
								}}>
								Clear visited
							</button>
							{statusMessage ?
								<span className='text-sm text-slate-300'>{statusMessage}</span>
							:	null}
						</form>
					</div>
					<div className='flex items-center gap-3'>
						<div className='flex items-center rounded-xl border border-white/10 bg-white/5 p-1'>
							<button
								className={`rounded-lg px-3 py-2 text-sm font-medium transition ${graphMode === '2d' ? 'bg-sky-400 text-slate-950 shadow-sm shadow-sky-950/20' : 'text-slate-200 hover:bg-white/10'}`}
								onClick={() => handleGraphModeChange('2d')}
								type='button'>
								2D
							</button>
							<button
								className={`rounded-lg px-3 py-2 text-sm font-medium transition ${graphMode === '3d' ? 'bg-sky-400 text-slate-950 shadow-sm shadow-sky-950/20' : 'text-slate-200 hover:bg-white/10'}`}
								onClick={() => handleGraphModeChange('3d')}
								type='button'>
								3D
							</button>
						</div>
						<button
							className='rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-slate-200 transition hover:bg-white/10'
							onClick={() => setMenuOpen((currentValue) => !currentValue)}
							type='button'>
							Toggle menu
						</button>
					</div>
				</div>
			</header>

			<div className='flex h-full pt-22'>
				{menuOpen ?
					<aside
						className='z-20 flex h-full w-90 shrink-0 flex-col overflow-y-auto border-r px-4 py-4 lg:px-5'
						style={{ background: dataset.visual.panelBackground, borderColor: dataset.visual.panelBorder }}>
						<div className='grid grid-cols-4 gap-2'>
							<button
								className='rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-medium text-slate-200'
								onClick={() => setPanelPinned((currentValue) => !currentValue)}
								type='button'>
								{panelPinned ? 'Unpin' : 'Pin'} panel
							</button>
							<button
								className='rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-medium text-slate-200'
								onClick={() => centerOnNode(selectedNodeId)}
								type='button'>
								Center
							</button>
							<button
								className='rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-medium text-slate-200'
								onClick={handleReflow}
								type='button'>
								Refresh
							</button>
						</div>
						<button
							className='rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-medium text-slate-200'
							onClick={handleLoadAllNodes}
							type='button'>
							Load all nodes
						</button>

						<div className='mt-4 flex flex-wrap gap-2'>
							<button
								className={`rounded-full px-3 py-1.5 text-xs font-medium ${traceMode ? 'bg-sky-400 text-slate-950' : 'border border-white/10 bg-white/5 text-slate-200'}`}
								onClick={() => {
									setTraceMode((currentValue) => !currentValue);
									appendLog(traceMode ? 'Disabled trace mode.' : 'Enabled trace mode.');
								}}
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
								onClick={() => setShowLegend((currentValue) => !currentValue)}
								type='button'>
								Legend
							</button>
						</div>

						<div className='mt-3 rounded-2xl border border-white/10 bg-slate-950/40 p-3 text-xs text-slate-400'>
							Colors shown here track the legend below: firm nodes are orange hexagons, person nodes are blue squares, selected nodes are white, active paths are cyan, and
							disclosure links are gray. Closed loops glow violet.
						</div>

						{showLegend ?
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
						:	null}

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
										<div className='rounded-full border border-slate-700/70 bg-slate-950/70 px-3 py-1 text-xs uppercase tracking-[0.24em] text-slate-300'>
											{hasDisclosureLinks(activeNode) ? 'Disclosure linked' : 'No disclosure'}
										</div>
										<button
											className='rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-white'
											onClick={() => setShowInfo((currentValue) => !currentValue)}
											type='button'>
											Info {showInfo ? '▾' : '▸'}
										</button>
										<button
											className='rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-white'
											onClick={() => setShowLog((currentValue) => !currentValue)}
											type='button'>
											Log {showLog ? '▾' : '▸'}
										</button>
									</div>

									{showInfo ?
										<div className='mt-4 space-y-4'>
											{activeNode.externalLinks.length > 0 ?
												<div className='flex flex-wrap gap-2'>
													{activeNode.externalLinks.map((link) => (
														<a
															className='rounded-full border border-sky-300/20 bg-sky-400/10 px-3 py-1 text-xs font-medium text-sky-200 transition hover:bg-sky-400/20'
															href={link.href}
															key={link.href}
															rel='noreferrer'
															target='_blank'>
															↗ {link.label}
														</a>
													))}
												</div>
											:	null}
											{activeNode.subtitle ?
												<div className='text-xs leading-5 text-slate-400'>{activeNode.subtitle}</div>
											:	null}
											{activeNode.detailSections.map((section) => (
												<div
													className='rounded-2xl border border-white/10 bg-slate-950/35 p-4'
													key={`${activeNode.id}-${section.title}`}>
													<div className='mb-2 text-sm font-semibold text-white'>{section.title}</div>
													{section.items?.map((item) => (
														<div
															className='grid grid-cols-[120px_1fr] gap-3 py-1 text-sm'
															key={`${section.title}-${item.label}`}>
															<div className='text-slate-400'>{item.label}</div>
															<div className='text-slate-100'>
																{item.href ?
																	<a
																		className='text-sky-300 hover:text-sky-200'
																		href={item.href}
																		rel='noreferrer'
																		target='_blank'>
																		{item.value}
																	</a>
																:	item.value}
															</div>
														</div>
													))}
													{section.paragraphs?.map((paragraph) => (
														<p
															className='text-sm leading-6 text-slate-300'
															key={`${section.title}-${paragraph}`}>
															{paragraph}
														</p>
													))}
												</div>
											))}
										</div>
									:	null}

									{showLog ?
										<div className='mt-4 rounded-2xl border border-white/10 bg-slate-950/35 p-4'>
											<div className='mb-2 text-sm font-semibold text-white'>Selection Log</div>
											<ul className='space-y-2 text-sm text-slate-300'>
												{selectionLog.map((entry, index) => (
													<li key={`${entry}-${index}`}>{entry}</li>
												))}
											</ul>
										</div>
									:	null}
								</>
							:	<div className='text-sm text-slate-300'>
									FIRST TIME HERE?
									<div className='mt-2 text-slate-400'>
										Start with the search field above. Selecting a firm shows its employees; selecting a person shows their firms and connections.
									</div>
								</div>
							}
						</div>
					</aside>
				:	null}

				<main className='relative flex-1'>
					{graphMode === '2d' ?
						<ForceGraphCanvas
							ref={graphRef}
							graphData={visibleGraph}
							backgroundColor={dataset.visual.backgroundColor}
							nodeRelSize={1}
							nodeVal={(node: GraphNode) => node.size}
							nodeLabel={(node: GraphNode) => `${node.title} • ${getKindLabel(node.kind)} • ${node.degreeHint} connections`}
							nodeCanvasObject={renderNode}
							nodePointerAreaPaint={renderNodePointerArea}
							linkCanvasObjectMode='replace'
							linkCanvasObject={renderLink}
							linkWidth={(link: GraphLink) =>
								highlightedLinkIds.has(getLinkKey(link as GraphLink)) ? dataset.visual.activeLinkWidth
								: cycleLinkIds.has(getLinkKey(link as GraphLink)) ? dataset.visual.cycleLinkWidth
								: dataset.visual.linkWidth + ((link.weight ?? 1) - 1) * 0.25
							}
							linkColor={(link: GraphLink) => getLinkTypeColor(link as GraphLink)}
							d3AlphaMin={dataset.force.alphaMin}
							d3AlphaDecay={dataset.force.alphaDecay}
							d3VelocityDecay={dataset.force.velocityDecay}
							warmupTicks={dataset.force.warmupTicks}
							cooldownTicks={dataset.force.cooldownTicks}
							autoPauseRedraw={true}
							onNodeHover={(node: NodeObject<GraphNode> | null) => setHoveredNodeId(node ? String(node.id) : null)}
							onNodeClick={handleNodeClick}
							onBackgroundClick={handleBackgroundClick}
						/>
					:	<ForceGraphCanvas
							ref={graphRef}
							graphData={visibleGraph}
							backgroundColor={dataset.visual.backgroundColor}
							nodeRelSize={1}
							nodeVal={(node: GraphNode) => node.size}
							nodeLabel={(node: GraphNode) => `${node.title} • ${getKindLabel(node.kind)} • ${node.degreeHint} connections`}
							nodeThreeObject={(node: GraphNode) => createNodeThreeObject(node)}
							linkWidth={(link: GraphLink) =>
								highlightedLinkIds.has(getLinkKey(link as GraphLink)) ? dataset.visual.activeLinkWidth
								: cycleLinkIds.has(getLinkKey(link as GraphLink)) ? dataset.visual.cycleLinkWidth
								: dataset.visual.linkWidth + ((link.weight ?? 1) - 1) * 0.25
							}
							linkColor={(link: GraphLink) => {
								if (isPreviousLink(link)) return 'rgba(0, 0, 0, 0)';
								return getLinkTypeColor(link as GraphLink);
							}}
							linkOpacity={(link: GraphLink) => {
								if (highlightedLinkIds.has(getLinkKey(link))) return 1;
								if (cycleLinkIds.has(getLinkKey(link))) return 0.95;
								return isPreviousLink(link) ? 0 : 0.4;
							}}
							linkThreeObject={(link: GraphLink) => {
								if (isLargeGraph || !isPreviousLink(link)) return null;
								const source = link.source as GraphNode;
								const target = link.target as GraphNode;
								const dashed = isInactiveLink(link);
								const points = [new THREE.Vector3(source.x ?? 0, source.y ?? 0, 0), new THREE.Vector3(target.x ?? 0, target.y ?? 0, 0)];
								const geometry = new THREE.BufferGeometry().setFromPoints(points);
								let material;
								const disclosureColor = getLinkTypeColor(link as GraphLink);
								if (dashed) {
									material = new THREE.LineDashedMaterial({
										color: typeof disclosureColor === 'string' ? disclosureColor : '#94a3b8',
										dashSize: 0.1,
										gapSize: 0.1,
										transparent: true,
										opacity: 0.75,
									});
								} else {
									material = new THREE.LineBasicMaterial({ color: typeof disclosureColor === 'string' ? disclosureColor : '#94a3b8', transparent: true, opacity: 0.75 });
								}
								const line = new THREE.Line(geometry, material);
								if (dashed) {
									line.computeLineDistances();
								}
								return line;
							}}
							enableNodeDrag={!isLargeGraph}
							autoPauseRedraw={true}
							onNodeHover={(node: NodeObject<GraphNode> | null) => setHoveredNodeId(node ? String(node.id) : null)}
							onNodeClick={handleNodeClick}
							onBackgroundClick={handleBackgroundClick}
						/>
					}

					<button
						className='absolute bottom-5 left-1/2 -translate-x-1/2 rounded-full border border-white/10 bg-slate-950/80 px-5 py-2 text-sm text-slate-200 shadow-lg shadow-slate-950/50 backdrop-blur'
						type='button'>
						Displayed: {displayedStats.people} People {displayedStats.firms} Firms {displayedStats.links} Links
					</button>
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
		case 'neutral':
		default:
			return 'rounded-full bg-slate-400/10 px-3 py-1 text-xs font-medium text-slate-200';
	}
}
