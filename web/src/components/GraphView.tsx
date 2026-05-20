'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CosmographProps, CosmographRef } from '@cosmograph/react';

import {
	createGraphDataset,
	expandSelection,
	getDisplayedStats,
	getEndpointId,
	getKindLabel,
	getLinkIdentityKey,
	inferRelatedGraphFromDetails,
	mergeGraphDataset,
	projectGraphData,
	type BadgeTone,
	type GraphDataset,
	type GraphLink,
	type GraphNode,
	type RemoteGraphSearchResult,
} from '@/lib/graph-data';
import { DEFAULT_REGULATOR_SCHEMA } from '@/lib/regulator-schemas';

type CosmographComponentType = React.ComponentType<
	CosmographProps & {
		ref?: React.Ref<CosmographRef>;
	}
>;

type CosmographNode = Record<string, unknown> & {
	id: string;
	pointIndex: number;
	label: string;
	title: string;
	kind: GraphNode['kind'];
	degreeHint: number;
	graphColor: string;
	graphSize: number;
	graphLabelWeight: number;
	x?: number;
	y?: number;
};

type CosmographLink = Record<string, unknown> & {
	source: string;
	target: string;
	sourceIndex: number;
	targetIndex: number;
	weight: number;
	relationship: GraphLink['relationship'];
	graphColor: string;
	graphWidth: number;
	graphStrength: number;
};

type PointPosition = {
	x: number;
	y: number;
};

const COSMOGRAPH_FIT_VIEW_PADDING = 0.14;
const HOLD_TO_DRAG_MS = 500;
const CLICK_MOVE_TOLERANCE_PX = 6;

type DragCandidate = {
	pointerId: number;
	nodeId: string;
	nodeIndex: number;
	startClientX: number;
	startClientY: number;
	lastClientX: number;
	lastClientY: number;
	dragActive: boolean;
};

function getOrganicShellPosition(node: GraphNode, nodeIndex: number, totalNodes: number, maxDegreeHint: number): { x: number; y: number } {
	const goldenAngle = Math.PI * (3 - Math.sqrt(5));
	const normalizedIndex = nodeIndex + 1;
	const normalizedTotal = Math.max(1, totalNodes);
	const orbitalProgress = Math.sqrt(normalizedIndex / normalizedTotal);
	const normalizedDegree = maxDegreeHint > 0 ? node.degreeHint / maxDegreeHint : 0;
	const connectionMass = Math.log2(Math.max(1, node.degreeHint) + 1);
	const shellBias =
		node.isHub ? 0.18
		: node.kind === 'firm' ? 0.34
		: 0.68;
	const radialSpan = 220 + Math.sqrt(normalizedTotal) * 26;
	const shellRadius = 46 + shellBias * 96 + orbitalProgress * radialSpan - normalizedDegree * 10 - Math.min(10, connectionMass * 1.8);
	const angle = normalizedIndex * goldenAngle + normalizedDegree * 0.035;
	const ellipticalStretchX = node.kind === 'firm' ? 1.18 : 1.26;
	const ellipticalStretchY = node.kind === 'firm' ? 0.92 : 1.08;
	const radialJitter = (((nodeIndex * 17) % 11) - 5) * 1.6;
	const tangentialJitter = (((nodeIndex * 13) % 9) - 4) * 1.1;

	return {
		x: Math.cos(angle) * (shellRadius + radialJitter) * ellipticalStretchX - Math.sin(angle) * tangentialJitter,
		y: Math.sin(angle) * (shellRadius - radialJitter * 0.35) * ellipticalStretchY + Math.cos(angle) * tangentialJitter * 0.75,
	};
}

function getConnectionGravityBias(sourceDegree: number, targetDegree: number): number {
	return Math.log2(sourceDegree + targetDegree + 2);
}

function getClusterAngleSeed(nodeId: string): number {
	let hash = 0;
	for (let index = 0; index < nodeId.length; index += 1) {
		hash = (hash * 31 + nodeId.charCodeAt(index)) >>> 0;
	}
	return (hash % 360) * (Math.PI / 180);
}

function getClusteredExpansionPosition(
	anchorPosition: PointPosition,
	anchorNode: GraphNode,
	node: GraphNode,
	nodeIndex: number,
	nodeCount: number,
	ringDepth: number,
): PointPosition {
	const baseAngle = getClusterAngleSeed(anchorNode.id) + ringDepth * 0.42;
	const slice = (Math.PI * 2) / Math.max(1, nodeCount);
	const angle = baseAngle + nodeIndex * slice;
	const anchorMass = Math.log2(Math.max(1, anchorNode.degreeHint) + 1);
	const nodeMass = Math.log2(Math.max(1, node.degreeHint) + 1);
	const ringRadius = Math.max(34, anchorNode.size * 1.22 + 26 + ringDepth * 22 + Math.max(0, nodeCount - 1) * 2.4 + anchorMass * 4.8 + nodeMass * 2.6);
	const ellipseX = node.kind === 'firm' ? 1.1 : 1.22;
	const ellipseY = node.kind === 'firm' ? 0.92 : 1.06;
	const jitter = ((nodeIndex % 5) - 2) * 1.25;
	const tangentialOffset = (nodeIndex % 2 === 0 ? 1 : -1) * (ringDepth + 1) * 6.5;

	return {
		x: anchorPosition.x + Math.cos(angle) * (ringRadius + jitter) * ellipseX - Math.sin(angle) * tangentialOffset,
		y: anchorPosition.y + Math.sin(angle) * (ringRadius - jitter * 0.4) * ellipseY + Math.cos(angle) * tangentialOffset * 0.65,
	};
}

function areNodeIdSetsEqual(left: Set<string>, right: Set<string>): boolean {
	if (left === right) {
		return true;
	}

	if (left.size !== right.size) {
		return false;
	}

	for (const value of left) {
		if (!right.has(value)) {
			return false;
		}
	}

	return true;
}

export default function GraphView() {
	const [dataset, setDataset] = useState<GraphDataset>(() => createGraphDataset());
	const regulatorSchema = DEFAULT_REGULATOR_SCHEMA;
	const regulatorLabel = regulatorSchema['search-results']['x-site-source'];
	const graphRef = useRef<CosmographRef>(undefined);
	const graphSurfaceRef = useRef<HTMLDivElement>(null);
	const searchInputRef = useRef<HTMLInputElement>(null);

	const [CosmographCanvas, setCosmographCanvas] = useState<CosmographComponentType | null>(null);
	const [visibleNodeIds, setVisibleNodeIds] = useState<Set<string>>(() => new Set(dataset.initialVisibleNodeIds));
	const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
	const [searchQuery, setSearchQuery] = useState('');
	const [statusMessage, setStatusMessage] = useState(`Ready with a seeded ${regulatorLabel} graph. Search a name like “thornton”.`);
	const [selectionLog, setSelectionLog] = useState<string[]>(['Loaded NEXA SECURITIES demo graph.']);
	const [showInfo, setShowInfo] = useState(true);
	const [showLog, setShowLog] = useState(false);
	const [traceMode, setTraceMode] = useState(false);
	const [showLegend, setShowLegend] = useState(false);
	const [menuOpen, setMenuOpen] = useState(true);
	const [panelPinned, setPanelPinned] = useState(true);
	const [isSearchingUpstream, setIsSearchingUpstream] = useState(false);
	const previousVisibleGraphSizeRef = useRef({ nodes: 0, links: 0 });
	const hoveredPointIndexRef = useRef<number | null>(null);
	const hoveredPointIdRef = useRef<string | null>(null);
	const suppressNextCanvasClickRef = useRef(false);
	const holdToDragTimerRef = useRef<number | null>(null);
	const dragCandidateRef = useRef<DragCandidate | null>(null);
	const dragAnimationFrameRef = useRef<number | null>(null);
	const pendingDragPositionRef = useRef<{ nodeId: string; position: PointPosition; fixed: boolean } | null>(null);
	const handleNodeSelectionRef = useRef<(nodeId: string) => void>(() => undefined);
	const selectedAnchorNodeIdRef = useRef<string | null>(null);
	const hasAutoReflowedOnLoadRef = useRef(false);

	const visibleGraph = useMemo(() => projectGraphData(dataset, visibleNodeIds), [dataset, visibleNodeIds]);
	const selectedNode = selectedNodeId ? (dataset.nodeById.get(selectedNodeId) ?? null) : null;
	const displayedStats = useMemo(() => getDisplayedStats(visibleGraph), [visibleGraph]);
	const graphHighlightNodeId = traceMode ? selectedNodeId : null;

	const highlightedNodeIds = useMemo(() => {
		if (!traceMode || !selectedNodeId) {
			return new Set<string>();
		}

		return expandSelection(dataset, selectedNodeId);
	}, [dataset, selectedNodeId, traceMode]);

	const highlightedLinkIds = useMemo(() => {
		if (!traceMode || !selectedNodeId) {
			return new Set<string>();
		}

		return new Set(
			visibleGraph.links
				.filter((link) => {
					const source = getEndpointId(link.source);
					const target = getEndpointId(link.target);
					return highlightedNodeIds.has(source) && highlightedNodeIds.has(target);
				})
				.map((link) => getLinkIdentityKey(link)),
		);
	}, [highlightedNodeIds, selectedNodeId, traceMode, visibleGraph.links]);

	useEffect(() => {
		let isMounted = true;

		import('@cosmograph/react').then((module) => {
			if (isMounted) {
				setCosmographCanvas(() => module.Cosmograph as unknown as CosmographComponentType);
			}
		});

		return () => {
			isMounted = false;
		};
	}, []);

	useEffect(() => {
		searchInputRef.current?.focus();
	}, []);

	const appendLog = useCallback((entry: string) => {
		setSelectionLog((currentEntries) => [entry, ...currentEntries].slice(0, 10));
	}, []);

	const hydrateNodeRelationships = useCallback((baseDataset: GraphDataset, nodeId: string) => {
		const sourceNode = baseDataset.nodeById.get(nodeId);
		const inferredPayload = inferRelatedGraphFromDetails(baseDataset, nodeId, sourceNode?.kind === 'firm' ? { allowedRelationships: ['employment'] } : undefined);
		if (inferredPayload.nodes.length === 0 && inferredPayload.links.length === 0) {
			return {
				dataset: baseDataset,
				addedNodeCount: 0,
				addedLinkCount: 0,
			};
		}

		return {
			dataset: mergeGraphDataset(baseDataset, inferredPayload),
			addedNodeCount: inferredPayload.nodes.length,
			addedLinkCount: inferredPayload.links.length,
		};
	}, []);

	const cosmographGraph = useMemo(() => {
		const totalVisibleNodes = Math.max(1, visibleGraph.nodes.length);
		const maxDegreeHint = visibleGraph.nodes.reduce((maxDegree, node) => Math.max(maxDegree, node.degreeHint), 0);
		const points: CosmographNode[] = visibleGraph.nodes.map((node, index) => {
			const isHighlighted = highlightedNodeIds.has(node.id);
			const baseColor =
				graphHighlightNodeId === node.id ? dataset.visual.activeNodeColor
				: traceMode && isHighlighted ? dataset.visual.neighborNodeColor
				: dataset.visual.nodeColors[node.kind];

			const fallbackPosition = getOrganicShellPosition(node, index, totalVisibleNodes, maxDegreeHint);

			return {
				id: node.id,
				pointIndex: index,
				label: node.label,
				title: node.title,
				kind: node.kind,
				degreeHint: node.degreeHint,
				graphColor: baseColor,
				graphSize: node.size,
				graphLabelWeight: Math.max(
					1,
					node.degreeHint +
						(graphHighlightNodeId === node.id ? 24
						: traceMode && isHighlighted ? 10
						: 0),
				),
				x: node.x ?? fallbackPosition.x,
				y: node.y ?? fallbackPosition.y,
			};
		});

		const pointIndexByNodeId = new Map(points.map((node, index) => [node.id, index]));

		const links: CosmographLink[] = visibleGraph.links.map((link) => {
			const isHighlighted = highlightedLinkIds.has(getLinkIdentityKey(link));
			const source = getEndpointId(link.source);
			const target = getEndpointId(link.target);
			const sourceNode = dataset.nodeById.get(source);
			const targetNode = dataset.nodeById.get(target);
			const connectionGravityBias = getConnectionGravityBias(sourceNode?.degreeHint ?? 0, targetNode?.degreeHint ?? 0);
			const relationshipVisual = getRelationshipVisual(link.relationship);

			return {
				source,
				target,
				sourceIndex: pointIndexByNodeId.get(source) ?? 0,
				targetIndex: pointIndexByNodeId.get(target) ?? 0,
				weight: link.weight,
				relationship: link.relationship,
				graphColor: isHighlighted ? relationshipVisual.highlightColor : relationshipVisual.color,
				graphWidth:
					isHighlighted ?
						Math.max(dataset.visual.activeLinkWidth, relationshipVisual.width + 0.45 + connectionGravityBias * 0.04)
					:	relationshipVisual.width + ((link.weight ?? 1) - 1) * 0.18 + connectionGravityBias * 0.035,
				graphStrength: dataset.force.linkStrength + relationshipVisual.strengthDelta + ((link.weight ?? 1) - 1) * 0.02 + connectionGravityBias * 0.018,
			};
		});

		return { points, links };
	}, [
		dataset.force.linkStrength,
		dataset.nodeById,
		dataset.visual,
		graphHighlightNodeId,
		highlightedLinkIds,
		highlightedNodeIds,
		traceMode,
		visibleGraph.links,
		visibleGraph.nodes,
	]);

	const nodeIndexById = useMemo(() => new Map(cosmographGraph.points.map((node, index) => [node.id, index])), [cosmographGraph.points]);
	const renderedNodePositionById = useMemo(
		() =>
			new Map(
				cosmographGraph.points.map((node) => [
					node.id,
					{
						x: Number(node.x ?? 0),
						y: Number(node.y ?? 0),
					},
				]),
			),
		[cosmographGraph.points],
	);

	const centerOnNode = useCallback(
		(nodeId: string | null) => {
			const graph = graphRef.current;
			if (!graph || !nodeId) {
				return;
			}

			const nodeIndex = nodeIndexById.get(nodeId);
			if (nodeIndex === undefined) {
				return;
			}

			graph.zoomToPoint(nodeIndex, dataset.viewport.focusDurationMs, dataset.force.focusZoom, true);
		},
		[dataset.force.focusZoom, dataset.viewport.focusDurationMs, nodeIndexById],
	);

	const nudgeGraphLayout = useCallback(
		(impulse = dataset.force.manualReheatImpulse) => {
			if (visibleGraph.nodes.length <= 1) {
				return;
			}

			graphRef.current?.start(impulse);
		},
		[dataset.force.manualReheatImpulse, visibleGraph.nodes.length],
	);

	const updateNodePosition = useCallback((nodeId: string, position: PointPosition, fixed: boolean) => {
		setDataset((currentDataset) => {
			const targetNode = currentDataset.nodeById.get(nodeId);
			if (!targetNode) {
				return currentDataset;
			}

			const updatedNode: GraphNode =
				fixed ?
					{
						...targetNode,
						x: position.x,
						y: position.y,
						fx: position.x,
						fy: position.y,
					}
				:	{
						...targetNode,
						x: position.x,
						y: position.y,
						fx: undefined,
						fy: undefined,
					};

			const nextNodes = currentDataset.graphData.nodes.map((node) => (node.id === nodeId ? updatedNode : node));

			return {
				...currentDataset,
				graphData: {
					...currentDataset.graphData,
					nodes: nextNodes,
				},
				nodeById: new Map(nextNodes.map((node) => [node.id, node])),
			};
		});
	}, []);

	const anchorSelectionInDataset = useCallback(
		(currentDataset: GraphDataset, previousAnchorNodeId: string | null, nextAnchorNodeId: string | null, anchorPosition?: PointPosition | null): GraphDataset => {
			let didChange = false;
			const nextNodes = currentDataset.graphData.nodes.map((node) => {
				if (nextAnchorNodeId && node.id === nextAnchorNodeId) {
					const lockedPosition = anchorPosition ?? {
						x: node.x ?? node.fx ?? 0,
						y: node.y ?? node.fy ?? 0,
					};

					if (node.x === lockedPosition.x && node.y === lockedPosition.y && node.fx === lockedPosition.x && node.fy === lockedPosition.y) {
						return node;
					}

					didChange = true;
					return {
						...node,
						x: lockedPosition.x,
						y: lockedPosition.y,
						fx: lockedPosition.x,
						fy: lockedPosition.y,
					};
				}

				if (previousAnchorNodeId && previousAnchorNodeId !== nextAnchorNodeId && node.id === previousAnchorNodeId && (node.fx !== undefined || node.fy !== undefined)) {
					didChange = true;
					// eslint-disable-next-line @typescript-eslint/no-unused-vars
					const { fx: _fx, fy: _fy, ...rest } = node;
					return rest;
				}

				return node;
			});

			if (!didChange) {
				return currentDataset;
			}

			return {
				...currentDataset,
				graphData: {
					...currentDataset.graphData,
					nodes: nextNodes,
				},
				nodeById: new Map(nextNodes.map((node) => [node.id, node])),
			};
		},
		[],
	);

	const flushPendingDragPosition = useCallback(() => {
		dragAnimationFrameRef.current = null;
		const pendingDragPosition = pendingDragPositionRef.current;
		if (!pendingDragPosition) {
			return;
		}

		updateNodePosition(pendingDragPosition.nodeId, pendingDragPosition.position, pendingDragPosition.fixed);
	}, [updateNodePosition]);

	const scheduleNodePositionUpdate = useCallback(
		(nodeId: string, position: PointPosition, fixed: boolean) => {
			pendingDragPositionRef.current = { nodeId, position, fixed };
			if (dragAnimationFrameRef.current !== null) {
				return;
			}

			dragAnimationFrameRef.current = window.requestAnimationFrame(flushPendingDragPosition);
		},
		[flushPendingDragPosition],
	);

	const getSpacePositionFromPointer = useCallback((clientX: number, clientY: number): PointPosition | null => {
		const graph = graphRef.current;
		const graphSurface = graphSurfaceRef.current;
		if (!graph || !graphSurface) {
			return null;
		}

		const bounds = graphSurface.getBoundingClientRect();
		const relativePosition: [number, number] = [clientX - bounds.left, clientY - bounds.top];
		const spacePosition = graph.screenToSpacePosition(relativePosition);
		if (!spacePosition) {
			return null;
		}

		return {
			x: spacePosition[0],
			y: spacePosition[1],
		};
	}, []);

	const clearHoldToDragTimer = useCallback(() => {
		if (holdToDragTimerRef.current !== null) {
			window.clearTimeout(holdToDragTimerRef.current);
			holdToDragTimerRef.current = null;
		}
	}, []);

	const finishDragInteraction = useCallback(
		(candidate: DragCandidate, wasCanceled: boolean) => {
			clearHoldToDragTimer();

			if (candidate.dragActive) {
				const finalPosition = getSpacePositionFromPointer(candidate.lastClientX, candidate.lastClientY);
				if (finalPosition) {
					scheduleNodePositionUpdate(candidate.nodeId, finalPosition, false);
				}
				suppressNextCanvasClickRef.current = true;
				graphRef.current?.start(0.1);
				dragCandidateRef.current = null;
				return;
			}

			const deltaX = candidate.lastClientX - candidate.startClientX;
			const deltaY = candidate.lastClientY - candidate.startClientY;
			const movedDistance = Math.hypot(deltaX, deltaY);

			if (!wasCanceled && movedDistance <= CLICK_MOVE_TOLERANCE_PX) {
				suppressNextCanvasClickRef.current = true;
				handleNodeSelectionRef.current(candidate.nodeId);
			}

			dragCandidateRef.current = null;
		},
		[clearHoldToDragTimer, getSpacePositionFromPointer, scheduleNodePositionUpdate],
	);

	const applyExpansionLayout = useCallback(
		(baseVisibleNodeIds: Set<string>, nextVisibleNodeIds: Set<string>, nextDataset: GraphDataset, anchorNodeId: string): GraphDataset => {
			const addedNodeIds = Array.from(nextVisibleNodeIds).filter((nodeId) => !baseVisibleNodeIds.has(nodeId) && nodeId !== anchorNodeId);
			if (addedNodeIds.length === 0) {
				return nextDataset;
			}

			const anchorNode = nextDataset.nodeById.get(anchorNodeId);
			if (!anchorNode) {
				return nextDataset;
			}

			const fallbackAnchorPosition = renderedNodePositionById.get(anchorNodeId) ?? {
				x: anchorNode.x ?? 0,
				y: anchorNode.y ?? 0,
			};
			const positionedNodes = new Map(nextDataset.graphData.nodes.map((node) => [node.id, node]));
			const placedPositions = new Map<string, PointPosition>([[anchorNodeId, fallbackAnchorPosition]]);

			const directNodeIds = addedNodeIds.filter((nodeId) =>
				(nextDataset.linksByNodeId.get(nodeId) ?? []).some((link) => getEndpointId(link.source) === anchorNodeId || getEndpointId(link.target) === anchorNodeId),
			);
			const directGroups = [
				...directNodeIds
					.map((nodeId) => nextDataset.nodeById.get(nodeId))
					.filter((node): node is GraphNode => Boolean(node))
					.sort((left, right) => right.degreeHint - left.degreeHint),
			];

			directGroups.forEach((node, index) => {
				const nextPosition = getClusteredExpansionPosition(fallbackAnchorPosition, anchorNode, node, index, directGroups.length, 0);
				positionedNodes.set(node.id, {
					...node,
					x: nextPosition.x,
					y: nextPosition.y,
				});
				placedPositions.set(node.id, nextPosition);
			});

			const secondaryGroups = new Map<string, GraphNode[]>();
			for (const nodeId of addedNodeIds) {
				if (directNodeIds.includes(nodeId)) {
					continue;
				}

				const node = nextDataset.nodeById.get(nodeId);
				if (!node) {
					continue;
				}

				const neighborIds = (nextDataset.linksByNodeId.get(nodeId) ?? [])
					.map((link) => {
						const sourceId = getEndpointId(link.source);
						const targetId = getEndpointId(link.target);
						return sourceId === nodeId ? targetId : sourceId;
					})
					.filter((neighborId) => placedPositions.has(neighborId) || baseVisibleNodeIds.has(neighborId));

				const preferredAnchorId = neighborIds.find((neighborId) => directNodeIds.includes(neighborId)) ?? neighborIds[0] ?? anchorNodeId;
				const anchorGroup = secondaryGroups.get(preferredAnchorId) ?? [];
				anchorGroup.push(node);
				secondaryGroups.set(preferredAnchorId, anchorGroup);
			}

			for (const [groupAnchorId, groupNodes] of secondaryGroups.entries()) {
				const groupAnchorNode = nextDataset.nodeById.get(groupAnchorId) ?? anchorNode;
				const groupAnchorPosition = placedPositions.get(groupAnchorId) ?? renderedNodePositionById.get(groupAnchorId) ?? fallbackAnchorPosition;
				const sortedGroupNodes = [...groupNodes].sort((left, right) => right.degreeHint - left.degreeHint);

				sortedGroupNodes.forEach((node, index) => {
					const nextPosition = getClusteredExpansionPosition(groupAnchorPosition, groupAnchorNode, node, index, sortedGroupNodes.length, groupAnchorId === anchorNodeId ? 1 : 2);
					positionedNodes.set(node.id, {
						...node,
						x: nextPosition.x,
						y: nextPosition.y,
					});
					placedPositions.set(node.id, nextPosition);
				});
			}

			const nextNodes = nextDataset.graphData.nodes.map((node) => positionedNodes.get(node.id) ?? node);

			return {
				...nextDataset,
				graphData: {
					...nextDataset.graphData,
					nodes: nextNodes,
				},
				nodeById: new Map(nextNodes.map((node) => [node.id, node])),
			};
		},
		[renderedNodePositionById],
	);

	useEffect(() => {
		const graph = graphRef.current;
		if (!graph) {
			return;
		}

		if (!selectedNodeId) {
			graph.fitView(dataset.viewport.fitViewDurationMs, COSMOGRAPH_FIT_VIEW_PADDING);
		}
	}, [dataset.viewport.fitViewDurationMs, selectedNodeId, visibleGraph.links.length, visibleGraph.nodes.length]);

	useEffect(() => {
		const graph = graphRef.current;
		if (!graph) {
			previousVisibleGraphSizeRef.current = {
				nodes: visibleGraph.nodes.length,
				links: visibleGraph.links.length,
			};
			return;
		}

		const previousGraphSize = previousVisibleGraphSizeRef.current;
		const addedNodes = Math.max(0, visibleGraph.nodes.length - previousGraphSize.nodes);
		const addedLinks = Math.max(0, visibleGraph.links.length - previousGraphSize.links);

		if (addedNodes > 0 || addedLinks > 0) {
			previousVisibleGraphSizeRef.current = {
				nodes: visibleGraph.nodes.length,
				links: visibleGraph.links.length,
			};

			// Reheat the simulation so new/updated nodes settle organically into the existing layout
			const isInitialGraphLoad = previousGraphSize.nodes === 0 && previousGraphSize.links === 0;
			const expansionImpulse = isInitialGraphLoad ? dataset.force.manualReheatImpulse : Math.min(0.34, dataset.force.simulationImpulse + addedNodes * 0.01 + addedLinks * 0.004);
			graph.start(expansionImpulse);

			return;
		}

		previousVisibleGraphSizeRef.current = {
			nodes: visibleGraph.nodes.length,
			links: visibleGraph.links.length,
		};
	}, [dataset, cosmographGraph.points, visibleGraph.links.length, visibleGraph.nodes.length]);

	useEffect(() => {
		if (hasAutoReflowedOnLoadRef.current) {
			return;
		}

		if (visibleGraph.nodes.length <= 1 || !graphRef.current) {
			return;
		}

		hasAutoReflowedOnLoadRef.current = true;
		nudgeGraphLayout();
	}, [nudgeGraphLayout, visibleGraph.nodes.length]);

	const handleNodeSelection = useCallback(
		(nodeId: string) => {
			const typedNode = dataset.nodeById.get(nodeId);
			if (!typedNode) {
				return;
			}

			const hydration = hydrateNodeRelationships(dataset, typedNode.id);
			const nextDataset = hydration.dataset;
			const nextVisibleNodeIds = new Set(nextDataset.graphData.nodes.map((node) => node.id));
			const hasExpansion = hydration.addedNodeCount > 0 || hydration.addedLinkCount > 0 || nextDataset !== dataset;

			if (hasExpansion) {
				const anchorPosition = renderedNodePositionById.get(typedNode.id) ?? {
					x: typedNode.x ?? typedNode.fx ?? 0,
					y: typedNode.y ?? typedNode.fy ?? 0,
				};
				const positionedDataset = applyExpansionLayout(visibleNodeIds, nextVisibleNodeIds, nextDataset, typedNode.id);
				const anchoredDataset = anchorSelectionInDataset(positionedDataset, selectedAnchorNodeIdRef.current, typedNode.id, anchorPosition);
				selectedAnchorNodeIdRef.current = typedNode.id;

				if (anchoredDataset !== dataset) {
					setDataset(anchoredDataset);
				}
			} else if (selectedAnchorNodeIdRef.current && selectedAnchorNodeIdRef.current !== typedNode.id) {
				const releasedDataset = anchorSelectionInDataset(dataset, selectedAnchorNodeIdRef.current, null, null);
				selectedAnchorNodeIdRef.current = null;
				if (releasedDataset !== dataset) {
					setDataset(releasedDataset);
				}
			}

			if (!areNodeIdSetsEqual(visibleNodeIds, nextVisibleNodeIds)) {
				setVisibleNodeIds(nextVisibleNodeIds);
			}
			setSelectedNodeId(typedNode.id);
			setMenuOpen(true);
			setShowInfo(true);
			setStatusMessage(
				hydration.addedNodeCount > 0 ? `Selected ${typedNode.title}. Added ${hydration.addedNodeCount} related nodes from detail sections.` : `Selected ${typedNode.title}.`,
			);
			appendLog(
				hydration.addedNodeCount > 0 ? `Selected ${typedNode.title} and expanded ${hydration.addedNodeCount} detail-derived relationships.` : `Selected ${typedNode.title}`,
			);
			window.requestAnimationFrame(() => {
				nudgeGraphLayout();
			});
		},
		[anchorSelectionInDataset, appendLog, applyExpansionLayout, dataset, hydrateNodeRelationships, nudgeGraphLayout, renderedNodePositionById, visibleNodeIds],
	);

	useEffect(() => {
		handleNodeSelectionRef.current = handleNodeSelection;
	}, [handleNodeSelection]);

	const handlePointClick = useCallback(
		(index: number) => {
			if (suppressNextCanvasClickRef.current) {
				suppressNextCanvasClickRef.current = false;
				return;
			}

			const node = cosmographGraph.points[index];
			if (node) {
				handleNodeSelection(node.id);
			}
		},
		[cosmographGraph.points, handleNodeSelection],
	);

	const handleLabelClick = useCallback(
		(index: number) => {
			if (suppressNextCanvasClickRef.current) {
				suppressNextCanvasClickRef.current = false;
				return;
			}

			const node = cosmographGraph.points[index];
			if (node) {
				handleNodeSelection(node.id);
			}
		},
		[cosmographGraph.points, handleNodeSelection],
	);

	const handleBackgroundClick = useCallback(() => {
		if (suppressNextCanvasClickRef.current) {
			suppressNextCanvasClickRef.current = false;
			return;
		}

		const anchoredDataset = anchorSelectionInDataset(dataset, selectedAnchorNodeIdRef.current, null, null);
		selectedAnchorNodeIdRef.current = null;
		if (anchoredDataset !== dataset) {
			setDataset(anchoredDataset);
		}

		setSelectedNodeId(null);
		setStatusMessage('Highlight cleared.');
		graphRef.current?.fitView(dataset.viewport.fitViewDurationMs, COSMOGRAPH_FIT_VIEW_PADDING);
	}, [anchorSelectionInDataset, dataset]);

	const handlePointMouseOver = useCallback(
		(index: number) => {
			const node = cosmographGraph.points[index];
			if (!node) {
				return;
			}

			hoveredPointIndexRef.current = index;
			hoveredPointIdRef.current = node.id;
		},
		[cosmographGraph.points],
	);

	const handlePointMouseOut = useCallback(() => {
		if (dragCandidateRef.current?.dragActive) {
			return;
		}

		hoveredPointIndexRef.current = null;
		hoveredPointIdRef.current = null;
	}, []);

	const handleGraphPointerDown = useCallback(
		(event: React.PointerEvent<HTMLDivElement>) => {
			if (event.button !== 0) {
				return;
			}

			const hoveredPointId = hoveredPointIdRef.current;
			const hoveredPointIndex = hoveredPointIndexRef.current;
			if (!hoveredPointId || hoveredPointIndex === null) {
				return;
			}

			event.currentTarget.setPointerCapture(event.pointerId);

			const nextCandidate: DragCandidate = {
				pointerId: event.pointerId,
				nodeId: hoveredPointId,
				nodeIndex: hoveredPointIndex,
				startClientX: event.clientX,
				startClientY: event.clientY,
				lastClientX: event.clientX,
				lastClientY: event.clientY,
				dragActive: false,
			};

			dragCandidateRef.current = nextCandidate;
			clearHoldToDragTimer();
			holdToDragTimerRef.current = window.setTimeout(() => {
				const activeCandidate = dragCandidateRef.current;
				if (!activeCandidate || activeCandidate.pointerId !== event.pointerId) {
					return;
				}

				activeCandidate.dragActive = true;
				suppressNextCanvasClickRef.current = true;
				const startDragPosition = getSpacePositionFromPointer(activeCandidate.lastClientX, activeCandidate.lastClientY);
				if (startDragPosition) {
					scheduleNodePositionUpdate(activeCandidate.nodeId, startDragPosition, true);
				}
			}, HOLD_TO_DRAG_MS);
		},
		[clearHoldToDragTimer, getSpacePositionFromPointer, scheduleNodePositionUpdate],
	);

	const handleGraphPointerMove = useCallback(
		(event: React.PointerEvent<HTMLDivElement>) => {
			const activeCandidate = dragCandidateRef.current;
			if (!activeCandidate || activeCandidate.pointerId !== event.pointerId) {
				return;
			}

			activeCandidate.lastClientX = event.clientX;
			activeCandidate.lastClientY = event.clientY;

			if (!activeCandidate.dragActive) {
				return;
			}

			const nextPosition = getSpacePositionFromPointer(event.clientX, event.clientY);
			if (!nextPosition) {
				return;
			}

			scheduleNodePositionUpdate(activeCandidate.nodeId, nextPosition, true);
		},
		[getSpacePositionFromPointer, scheduleNodePositionUpdate],
	);

	const handleGraphPointerUp = useCallback(
		(event: React.PointerEvent<HTMLDivElement>) => {
			const activeCandidate = dragCandidateRef.current;
			if (!activeCandidate || activeCandidate.pointerId !== event.pointerId) {
				return;
			}

			activeCandidate.lastClientX = event.clientX;
			activeCandidate.lastClientY = event.clientY;
			finishDragInteraction(activeCandidate, false);
		},
		[finishDragInteraction],
	);

	const handleGraphPointerCancel = useCallback(
		(event: React.PointerEvent<HTMLDivElement>) => {
			const activeCandidate = dragCandidateRef.current;
			if (!activeCandidate || activeCandidate.pointerId !== event.pointerId) {
				return;
			}

			finishDragInteraction(activeCandidate, true);
		},
		[finishDragInteraction],
	);

	useEffect(() => {
		return () => {
			clearHoldToDragTimer();
			if (dragAnimationFrameRef.current !== null) {
				window.cancelAnimationFrame(dragAnimationFrameRef.current);
			}
		};
	}, [clearHoldToDragTimer]);

	const handleSearchSubmit = useCallback(
		async (event: React.FormEvent<HTMLFormElement>) => {
			event.preventDefault();
			if (isSearchingUpstream) {
				searchInputRef.current?.focus();
				return;
			}

			const normalizedQuery = searchQuery.trim().toLowerCase();

			if (!normalizedQuery) {
				setStatusMessage('Enter a name, firm, or CRD/SEC# to expand the graph.');
				searchInputRef.current?.focus();
				return;
			}

			setSearchQuery('');
			setStatusMessage(`Checking local cache for “${normalizedQuery}”, then FINRA/SEC APIs if needed…`);
			appendLog(`Searched “${normalizedQuery}” via cache-first lookup.`);
			setIsSearchingUpstream(true);
			searchInputRef.current?.focus();

			try {
				const response = await fetch(`/api/finra/search?query=${encodeURIComponent(normalizedQuery)}`);
				const remoteResult = (await response.json()) as RemoteGraphSearchResult;

				if (!response.ok) {
					throw new Error(remoteResult.message || `Lookup failed with status ${response.status}.`);
				}

				if (!remoteResult.primaryMatchId || remoteResult.nodes.length === 0) {
					setStatusMessage(remoteResult.message);
					appendLog(`No cached or upstream matches found for “${normalizedQuery}”.`);
					return;
				}

				const mergedDataset = mergeGraphDataset(dataset, { nodes: remoteResult.nodes, links: remoteResult.links });
				const hydration = hydrateNodeRelationships(mergedDataset, remoteResult.primaryMatchId);
				const nextDataset = hydration.dataset;
				const searchResultNodeIds = new Set(remoteResult.nodes.map((node) => node.id));
				const hydratedNodeIds = nextDataset.graphData.nodes.filter((node) => !mergedDataset.nodeById.has(node.id)).map((node) => node.id);
				const nextVisibleNodeIds = new Set([...searchResultNodeIds, ...hydratedNodeIds]);
				const isolatedBaseVisibleNodeIds = new Set([remoteResult.primaryMatchId]);
				const positionedDataset = applyExpansionLayout(isolatedBaseVisibleNodeIds, nextVisibleNodeIds, nextDataset, remoteResult.primaryMatchId);
				const primaryNode = nextDataset.nodeById.get(remoteResult.primaryMatchId);
				const anchorPosition =
					primaryNode ?
						(renderedNodePositionById.get(remoteResult.primaryMatchId) ?? {
							x: primaryNode.x ?? primaryNode.fx ?? 0,
							y: primaryNode.y ?? primaryNode.fy ?? 0,
						})
					:	null;
				const anchoredDataset =
					anchorPosition ? anchorSelectionInDataset(positionedDataset, selectedAnchorNodeIdRef.current, remoteResult.primaryMatchId, anchorPosition) : positionedDataset;
				selectedAnchorNodeIdRef.current = anchorPosition ? remoteResult.primaryMatchId : selectedAnchorNodeIdRef.current;

				setDataset(anchoredDataset);
				if (!areNodeIdSetsEqual(visibleNodeIds, nextVisibleNodeIds)) {
					setVisibleNodeIds(nextVisibleNodeIds);
				}
				setSelectedNodeId(remoteResult.primaryMatchId);
				setMenuOpen(true);
				setShowInfo(true);
				setStatusMessage(
					hydration.addedNodeCount > 0 ?
						`${remoteResult.message} Showing an isolated cache/API result view with ${hydration.addedNodeCount} detail-derived nodes.`
					:	`${remoteResult.message} Showing an isolated cache/API result view.`,
				);
				appendLog(
					remoteResult.source === 'local' ?
						`Loaded ${remoteResult.matchedNodeIds.length} cached node(s) for “${normalizedQuery}” and isolated them from the current canvas view.`
					:	`Fetched ${remoteResult.matchedNodeIds.length} upstream node(s) for “${normalizedQuery}”, saved them locally, and isolated them from the current canvas view.`,
				);
				window.requestAnimationFrame(() => {
					nudgeGraphLayout();
				});
			} catch (error) {
				const message = error instanceof Error ? error.message : 'Unknown search failure.';
				setStatusMessage(`Unable to fetch cached/upstream data for “${normalizedQuery}”.`);
				appendLog(`Cache/upstream lookup failed for “${normalizedQuery}”: ${message}`);
			} finally {
				setIsSearchingUpstream(false);
				searchInputRef.current?.focus();
			}
		},
		[
			anchorSelectionInDataset,
			appendLog,
			applyExpansionLayout,
			dataset,
			hydrateNodeRelationships,
			isSearchingUpstream,
			nudgeGraphLayout,
			renderedNodePositionById,
			searchQuery,
			visibleNodeIds,
		],
	);

	const handleResetSession = useCallback(() => {
		const nextDataset = anchorSelectionInDataset(dataset, selectedAnchorNodeIdRef.current, null, null);
		selectedAnchorNodeIdRef.current = null;
		if (nextDataset !== dataset) {
			setDataset(nextDataset);
		}

		const resetVisibleNodeIds = new Set(dataset.initialVisibleNodeIds);
		if (!areNodeIdSetsEqual(visibleNodeIds, resetVisibleNodeIds)) {
			setVisibleNodeIds(resetVisibleNodeIds);
		}
		setSelectedNodeId(null);
		setTraceMode(false);
		setShowInfo(true);
		setShowLog(false);
		setIsSearchingUpstream(false);
		setSearchQuery('');
		setStatusMessage('Session reset. Select a node to explore the graph.');
		appendLog('Reset the local graph session.');
	}, [anchorSelectionInDataset, appendLog, dataset, visibleNodeIds]);

	const handleReflow = useCallback(() => {
		nudgeGraphLayout();
		setStatusMessage('Layout gently nudged.');
		appendLog('Reflowed the visible layout.');
	}, [appendLog, nudgeGraphLayout]);

	if (!CosmographCanvas) {
		return <div className='flex h-screen items-center justify-center bg-slate-950 text-white'>Loading Cosmograph...</div>;
	}

	return (
		<div
			className='h-screen w-screen overflow-hidden text-slate-100'
			style={{ background: dataset.visual.backgroundColor }}>
			<header className='absolute inset-x-0 top-0 z-30 border-b border-white/10 bg-slate-950/85 backdrop-blur-xl'>
				<div className='flex flex-wrap items-center justify-between gap-4 px-4 py-4 lg:px-6'>
					<div className='flex flex-1 flex-wrap items-center gap-4'>
						<div>
							<h1 className='text-2xl font-semibold tracking-[0.24em] text-white'>{regulatorLabel}</h1>
							<p className='mt-1 text-xs text-slate-400'>{regulatorSchema.home.title}</p>
						</div>
						<form
							className='flex min-w-70 flex-1 flex-wrap items-center gap-2'
							onSubmit={handleSearchSubmit}>
							<div className='min-w-55 flex-1 rounded-xl border border-white/10 bg-white/5 px-3 py-2 shadow-inner shadow-slate-950/40'>
								<input
									className='w-full bg-transparent text-sm text-slate-100 outline-none placeholder:text-slate-400'
									ref={searchInputRef}
									placeholder='firm, person, CRD/SEC#'
									value={searchQuery}
									onChange={(event) => setSearchQuery(event.target.value)}
								/>
							</div>
							<button
								className='rounded-xl bg-sky-400 px-4 py-2 text-sm font-medium text-slate-950 transition hover:bg-sky-300 disabled:cursor-not-allowed disabled:bg-slate-500'
								disabled={isSearchingUpstream}
								type='submit'>
								{isSearchingUpstream ? 'Checking APIs…' : 'Fetch Nodes'}
							</button>
							{statusMessage ?
								<span className='text-sm text-slate-300'>{statusMessage}</span>
							:	null}
						</form>
					</div>
					<button
						className='rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-slate-200 transition hover:bg-white/10'
						onClick={() => setMenuOpen((currentValue) => !currentValue)}
						type='button'>
						Toggle menu
					</button>
				</div>
			</header>

			<div className='flex h-full pt-22'>
				{menuOpen ?
					<aside
						className='z-20 flex h-full w-90 shrink-0 flex-col overflow-y-auto border-r px-4 py-4 lg:px-5'
						style={{ background: dataset.visual.panelBackground, borderColor: dataset.visual.panelBorder }}>
						<div className='grid grid-cols-3 gap-2'>
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
							{selectedNode ?
								<>
									<div className='text-2xl font-semibold text-white'>{selectedNode.title}</div>
									<div className='mt-1 text-sm text-slate-300'>{selectedNode.identifierLine}</div>
									<div className='mt-3 flex flex-wrap gap-2'>
										{selectedNode.badges.map((badge) => (
											<span
												className={getBadgeClassName(badge.tone)}
												key={`${selectedNode.id}-${badge.label}`}>
												{badge.label}
											</span>
										))}
									</div>
									<div className='mt-4 flex gap-3 rounded-2xl bg-slate-950/40 p-3'>
										<div className='flex h-10 w-10 items-center justify-center rounded-2xl bg-sky-400/15 text-lg font-semibold text-sky-200'>{selectedNode.marker}</div>
										<div>
											<div className='text-sm text-slate-200'>{selectedNode.summary}</div>
											<div className='mt-1 text-xs uppercase tracking-[0.22em] text-slate-500'>{getKindLabel(selectedNode.kind)}</div>
										</div>
									</div>
									<div className='mt-4 flex gap-2'>
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
											{selectedNode.externalLinks.length > 0 ?
												<div className='flex flex-wrap gap-2'>
													{selectedNode.externalLinks.map((link) => (
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
											{selectedNode.subtitle ?
												<div className='text-xs leading-5 text-slate-400'>{selectedNode.subtitle}</div>
											:	null}
											{selectedNode.detailSections.map((section) => (
												<div
													className='rounded-2xl border border-white/10 bg-slate-950/35 p-4'
													key={`${selectedNode.id}-${section.title}`}>
													<div className='mb-2 text-sm font-semibold text-white'>{section.title}</div>
													{section.items?.map((item) => (
														<div
															className='grid grid-cols-[120px_1fr] gap-3 py-1 text-sm'
															key={`${selectedNode.id}-${section.title}-${item.label}-${item.value}`}>
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
					<div
						className='absolute inset-0'
						onPointerCancel={handleGraphPointerCancel}
						onPointerDown={handleGraphPointerDown}
						onPointerMove={handleGraphPointerMove}
						onPointerUp={handleGraphPointerUp}
						ref={graphSurfaceRef}>
						<CosmographCanvas
							ref={graphRef}
							className='h-full w-full'
							style={{ height: '100%', width: '100%' }}
							backgroundColor={dataset.visual.backgroundColor}
							enableSimulation={visibleGraph.nodes.length > 1}
							preservePointPositionsOnDataUpdate
							points={cosmographGraph.points}
							links={cosmographGraph.links}
							pointIdBy='id'
							pointIndexBy='pointIndex'
							pointXBy='x'
							pointYBy='y'
							linkSourceBy='source'
							linkTargetBy='target'
							linkSourceIndexBy='sourceIndex'
							linkTargetIndexBy='targetIndex'
							pointColorBy='graphColor'
							pointColorByFn={(value: unknown) => String(value)}
							pointSizeBy='graphSize'
							pointSizeByFn={(value: unknown) => Number(value)}
							pointLabelBy='label'
							pointLabelWeightBy='graphLabelWeight'
							selectPointOnClick={false}
							selectPointOnLabelClick={false}
							focusPointOnClick={false}
							focusPointOnLabelClick={false}
							enableDrag={false}
							linkColorBy='graphColor'
							linkColorByFn={(value: unknown) => String(value)}
							linkWidthBy='graphWidth'
							linkWidthByFn={(value: unknown) => Number(value)}
							linkStrengthBy='graphStrength'
							linkStrengthByFn={(value: unknown) => Number(value)}
							showLabels
							showDynamicLabels
							showDynamicLabelsLimit={28}
							showTopLabels={false}
							showFocusedPointLabel
							showSelectedLabels
							resetSelectionOnEmptyCanvasClick
							fitViewDuration={dataset.viewport.fitViewDurationMs}
							fitViewPadding={COSMOGRAPH_FIT_VIEW_PADDING}
							simulationDecay={dataset.force.simulationDecay}
							simulationGravity={dataset.force.simulationGravity}
							simulationCenter={dataset.force.simulationCenter}
							simulationRepulsion={dataset.force.simulationRepulsion}
							simulationRepulsionFromMouse={dataset.force.simulationRepulsionFromMouse}
							simulationLinkDistance={dataset.force.linkDistance}
							simulationLinkDistRandomVariationRange={dataset.force.simulationLinkDistanceVariation}
							simulationFriction={dataset.force.simulationFriction}
							simulationImpulse={dataset.force.simulationImpulse}
							pointLabelColor={dataset.visual.nodeLabelColor}
							pointLabelFontSize={15}
							pointGreyoutOpacity={1}
							focusedPointRingColor={dataset.visual.focusedPointRingColor}
							hoveredPointRingColor={dataset.visual.hoveredPointRingColor}
							onPointMouseOut={handlePointMouseOut}
							onPointMouseOver={handlePointMouseOver}
							onPointClick={handlePointClick}
							onLabelClick={handleLabelClick}
							onBackgroundClick={handleBackgroundClick}
						/>
					</div>

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

function getRelationshipVisual(relationship: GraphLink['relationship']): { color: string; highlightColor: string; width: number; strengthDelta: number } {
	switch (relationship) {
		case 'control':
			return {
				color: 'rgba(248, 113, 113, 0.92)',
				highlightColor: 'rgba(252, 165, 165, 0.98)',
				width: 1.7,
				strengthDelta: 0.08,
			};
		case 'previous-employment':
			return {
				color: 'rgba(203, 213, 225, 0.42)',
				highlightColor: 'rgba(226, 232, 240, 0.84)',
				width: 1.05,
				strengthDelta: -0.02,
			};
		case 'disclosure':
			return {
				color: 'rgba(251, 191, 36, 0.72)',
				highlightColor: 'rgba(253, 224, 71, 0.92)',
				width: 1.4,
				strengthDelta: 0.04,
			};
		case 'peer':
			return {
				color: 'rgba(148, 163, 184, 0.34)',
				highlightColor: 'rgba(186, 230, 253, 0.88)',
				width: 1.05,
				strengthDelta: 0,
			};
		case 'employment':
		default:
			return {
				color: 'rgba(96, 165, 250, 0.82)',
				highlightColor: 'rgba(125, 211, 252, 0.96)',
				width: 1.35,
				strengthDelta: 0.02,
			};
	}
}
