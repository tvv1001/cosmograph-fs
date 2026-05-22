'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Graph from 'graphology';
import forceAtlas2 from 'graphology-layout-forceatlas2';

import {
	createGraphDataset,
	getDisplayedStats,
	getEndpointId,
	getKindLabel,
	inferRelatedGraphFromDetails,
	mergeGraphDataset,
	type GraphDataset,
	type GraphLink,
	type GraphNode,
	type RemoteGraphSearchResult,
} from '@/lib/graph-data';
import { DEFAULT_REGULATOR_SCHEMA } from '@/lib/regulator-schemas';
import { loadWasmSim, setBounds, clearBounds, setBoundaryMode } from '@/lib/wasm-sim';

type SigmaGraphNodeAttributes = {
	x: number;
	y: number;
	size: number;
	label: string;
	color: string;
	kind: GraphNode['kind'];
	degreeHint: number;
};

type SigmaGraphEdgeAttributes = {
	size: number;
	color: string;
	weight: number;
	relationship: GraphLink['relationship'];
};

type SigmaRendererLike = {
	on: (eventName: string, handler: (payload?: unknown) => void) => void;
	refresh: () => void;
	kill: () => void;
	getCamera: () => {
		animate: (state: { x: number; y: number; ratio: number }, options?: { duration?: number }) => void;
	};
};

const MOTION_SETTINGS = {
	adjustSizes: true,
	edgeWeightInfluence: 1.15,
	scalingRatio: 10,
	gravity: 0.08,
	slowDown: 14,
	barnesHutOptimize: true,
	barnesHutTheta: 0.6,
	linLogMode: true,
};

type MotionSettings = typeof MOTION_SETTINGS;

const INITIAL_BOOST_FRAMES = 12;
const SIGMA_INITIAL_SPREAD = 1.9;
const SIGMA_COLLISION_PADDING = 2.8;
const SIGMA_COLLISION_PASSES = 10;

function getFallbackPosition(node: GraphNode, index: number, totalNodes: number): { x: number; y: number } {
	const goldenAngle = Math.PI * (3 - Math.sqrt(5));
	const angle = goldenAngle * (index + 1);
	const radius = (14 + Math.sqrt(index + 1) * (node.kind === 'firm' ? 4.8 : 6.2) + Math.sqrt(totalNodes) * 0.75) * SIGMA_INITIAL_SPREAD;

	return {
		x: Math.cos(angle) * radius,
		y: Math.sin(angle) * radius,
	};
}

function resolveGraphOverlaps(graph: Graph<SigmaGraphNodeAttributes, SigmaGraphEdgeAttributes>, padding = SIGMA_COLLISION_PADDING, maxPasses = SIGMA_COLLISION_PASSES): void {
	const nodeIds = graph.nodes();
	if (nodeIds.length <= 1) {
		return;
	}

	for (let pass = 0; pass < maxPasses; pass += 1) {
		let moved = false;

		for (let leftIndex = 0; leftIndex < nodeIds.length; leftIndex += 1) {
			const leftId = nodeIds[leftIndex];
			const left = graph.getNodeAttributes(leftId);

			for (let rightIndex = leftIndex + 1; rightIndex < nodeIds.length; rightIndex += 1) {
				const rightId = nodeIds[rightIndex];
				const right = graph.getNodeAttributes(rightId);
				const deltaX = right.x - left.x;
				const deltaY = right.y - left.y;
				const distance = Math.hypot(deltaX, deltaY);
				const minimumDistance = left.size + right.size + padding;

				if (distance >= minimumDistance) {
					continue;
				}

				const safeDistance = distance > 0.0001 ? distance : 0.0001;
				const normalX = distance > 0.0001 ? deltaX / safeDistance : Math.cos((leftIndex + 1) * 1.618 + rightIndex * 0.73);
				const normalY = distance > 0.0001 ? deltaY / safeDistance : Math.sin((leftIndex + 1) * 1.618 + rightIndex * 0.73);
				const overlap = minimumDistance - safeDistance;
				const offsetX = normalX * overlap * 0.5;
				const offsetY = normalY * overlap * 0.5;

				graph.mergeNodeAttributes(leftId, {
					x: left.x - offsetX,
					y: left.y - offsetY,
				});
				graph.mergeNodeAttributes(rightId, {
					x: right.x + offsetX,
					y: right.y + offsetY,
				});

				moved = true;
			}
		}

		if (!moved) {
			break;
		}
	}
}

function getNodeColor(node: GraphNode, isSelected: boolean): string {
	if (isSelected) {
		return '#f8fafc';
	}

	return node.kind === 'firm' ? '#38bdf8' : '#22c55e';
}

function getEdgeColor(relationship: GraphLink['relationship']): string {
	switch (relationship) {
		case 'control':
			return 'rgba(248, 113, 113, 0.82)';
		case 'previous-employment':
			return 'rgba(203, 213, 225, 0.34)';
		case 'disclosure':
			return 'rgba(251, 191, 36, 0.72)';
		case 'peer':
			return 'rgba(148, 163, 184, 0.28)';
		case 'employment':
		default:
			return 'rgba(96, 165, 250, 0.72)';
	}
}

function buildSigmaGraph(
	dataset: GraphDataset,
	selectedNodeId: string | null,
	stabilize = true,
	padding = SIGMA_COLLISION_PADDING,
	maxPasses = SIGMA_COLLISION_PASSES,
): Graph<SigmaGraphNodeAttributes, SigmaGraphEdgeAttributes> {
	const graph = new Graph<SigmaGraphNodeAttributes, SigmaGraphEdgeAttributes>({ multi: true, type: 'undirected' });
	const totalNodes = Math.max(1, dataset.graphData.nodes.length);

	dataset.graphData.nodes.forEach((node, index) => {
		const fallbackPosition = getFallbackPosition(node, index, totalNodes);
		graph.addNode(node.id, {
			x: node.x ?? fallbackPosition.x,
			y: node.y ?? fallbackPosition.y,
			size: Math.max(node.kind === 'firm' ? 7 : 4, node.size * 0.22),
			label: node.label,
			color: getNodeColor(node, selectedNodeId === node.id),
			kind: node.kind,
			degreeHint: node.degreeHint,
		});
	});

	dataset.graphData.links.forEach((link, index) => {
		const source = getEndpointId(link.source);
		const target = getEndpointId(link.target);
		if (!graph.hasNode(source) || !graph.hasNode(target)) {
			return;
		}

		graph.addEdgeWithKey(`${source}->${target}:${link.relationship}:${index}`, source, target, {
			size: Math.max(1, 0.9 + (link.weight ?? 1) * 0.35),
			color: getEdgeColor(link.relationship),
			weight: link.weight ?? 1,
			relationship: link.relationship,
		});
	});

	if (stabilize) {
		resolveGraphOverlaps(graph, padding, maxPasses);
	}

	return graph;
}

export default function SigmaGraphView() {
	const regulatorSchema = DEFAULT_REGULATOR_SCHEMA;
	const regulatorLabel = regulatorSchema['search-results']['x-site-source'];
	const [dataset, setDataset] = useState<GraphDataset>(() => createGraphDataset());
	const [selectedNodeId, setSelectedNodeId] = useState<string | null>(dataset.initialNodeId ?? null);
	const [searchQuery, setSearchQuery] = useState('');
	const [isSearchingUpstream, setIsSearchingUpstream] = useState(false);
	const [statusMessage, setStatusMessage] = useState('Sigma WebGL motion trial ready with a very calm layout. Search a firm, person, CRD, or SEC number.');
	const [motionEnabled, setMotionEnabled] = useState(true);
	// Stabilization and motion tuning controls exposed to the UI
	const [stabilizationEnabled, setStabilizationEnabled] = useState(true);
	const [collisionPadding, setCollisionPadding] = useState(SIGMA_COLLISION_PADDING);
	const [collisionPasses, setCollisionPasses] = useState(SIGMA_COLLISION_PASSES);
	const [motionSettingsState, setMotionSettingsState] = useState<MotionSettings>(() => ({ ...MOTION_SETTINGS }));
	const [reheatFrames, setReheatFrames] = useState(16);
	const [selectWithoutViewMotion, setSelectWithoutViewMotion] = useState(true);
	const [springMotionEnabled, setSpringMotionEnabled] = useState(false);
	const containerRef = useRef<HTMLDivElement>(null);
	const forceLayoutRef = useRef<any | null>(null);
	const motionSettingsRef = useRef(motionSettingsState);
	const stabilizationRef = useRef(stabilizationEnabled);
	const collisionPaddingRef = useRef(collisionPadding);
	const collisionPassesRef = useRef(collisionPasses);
	const selectWithoutViewMotionRef = useRef(selectWithoutViewMotion);
	const selectionModeRef = useRef<'none' | 'click' | 'click-no-motion' | 'search' | 'reset' | 'programmatic'>('none');
	const selectedNodeIdRef = useRef<string | null>(selectedNodeId);
	const prevSelectedNodeIdRef = useRef<string | null>(null);
	const sigmaRef = useRef<SigmaRendererLike | null>(null);
	const graphRef = useRef<Graph<SigmaGraphNodeAttributes, SigmaGraphEdgeAttributes> | null>(null);
	const animationFrameRef = useRef<number | null>(null);
	const motionBoostFramesRef = useRef(INITIAL_BOOST_FRAMES);
	const searchInputRef = useRef<HTMLInputElement>(null);

	const displayedStats = useMemo(() => getDisplayedStats(dataset.graphData), [dataset.graphData]);
	const selectedNode = selectedNodeId ? (dataset.nodeById.get(selectedNodeId) ?? null) : null;

	const startMotionBoost = useCallback((frames = INITIAL_BOOST_FRAMES) => {
		motionBoostFramesRef.current = Math.max(motionBoostFramesRef.current, frames);
	}, []);

	useEffect(() => {
		searchInputRef.current?.focus();
	}, []);

	// keep a ref of the selected node id so mountSigma doesn't need selectedNodeId in its deps
	useEffect(() => {
		selectedNodeIdRef.current = selectedNodeId;
	}, [selectedNodeId]);

	// keep refs in sync so the animation loop (mounted once) can read latest settings
	useEffect(() => {
		motionSettingsRef.current = motionSettingsState;
	}, [motionSettingsState]);

	useEffect(() => {
		stabilizationRef.current = stabilizationEnabled;
	}, [stabilizationEnabled]);

	useEffect(() => {
		collisionPaddingRef.current = collisionPadding;
	}, [collisionPadding]);

	useEffect(() => {
		collisionPassesRef.current = collisionPasses;
	}, [collisionPasses]);

	useEffect(() => {
		selectWithoutViewMotionRef.current = selectWithoutViewMotion;
	}, [selectWithoutViewMotion]);

	useEffect(() => {
		const container = containerRef.current;
		if (!container) {
			return;
		}

		let active = true;
		let localSigma: SigmaRendererLike | null = null;

		const mountSigma = async () => {
			const { default: Sigma } = await import('sigma');
			if (!active || !containerRef.current) {
				return;
			}

			const graph = buildSigmaGraph(dataset, null, stabilizationRef.current, collisionPaddingRef.current, collisionPassesRef.current);
			const sigma = new Sigma(graph, containerRef.current, {
				renderLabels: true,
				renderEdgeLabels: false,
				labelDensity: 0.08,
				labelGridCellSize: 80,
				labelRenderedSizeThreshold: 8,
				zIndex: true,
				allowInvalidContainer: true,
				defaultNodeColor: '#38bdf8',
				defaultEdgeColor: 'rgba(96, 165, 250, 0.55)',
			}) as unknown as SigmaRendererLike;

			graphRef.current = graph;
			sigmaRef.current = sigma;
			localSigma = sigma;

			// If there is an active selection when mounting the graph, color it without remounting
			if (selectedNodeIdRef.current && graph.hasNode(selectedNodeIdRef.current)) {
				const nodeMeta = dataset.nodeById.get(selectedNodeIdRef.current);
				if (nodeMeta) {
					graph.mergeNodeAttributes(selectedNodeIdRef.current, { color: getNodeColor(nodeMeta, true) });
					prevSelectedNodeIdRef.current = selectedNodeIdRef.current;
				}
			}

			const clickNodeHandler = (payload?: unknown) => {
				const nodeId = typeof payload === 'object' && payload !== null && 'node' in payload ? String((payload as { node: string }).node) : null;
				if (!nodeId) {
					return;
				}

				// Mark selection origin and optionally avoid view motion / layout reheats
				if (selectWithoutViewMotionRef.current) {
					selectionModeRef.current = 'click-no-motion';
					setSelectedNodeId(nodeId);
				} else {
					selectionModeRef.current = 'click';
					setSelectedNodeId(nodeId);
					startMotionBoost(8);
				}
			};

			const clickStageHandler = () => {
				selectionModeRef.current = 'click-no-motion';
				setSelectedNodeId(null);
			};

			sigma.on('clickNode', clickNodeHandler);
			sigma.on('clickStage', clickStageHandler);

			// Expose a small compatibility API to mimic common Cosmograph helpers
			// - fitView(duration?, padding?)
			// - screenToSpacePosition(clientX, clientY)
			// - nudgeGraphLayout(frames?)
			const fitView = (duration = 600, padding = 0.06) => {
				try {
					const nodeIds = graph.nodes();
					if (!nodeIds || nodeIds.length === 0) return;

					let minX = Number.POSITIVE_INFINITY;
					let minY = Number.POSITIVE_INFINITY;
					let maxX = Number.NEGATIVE_INFINITY;
					let maxY = Number.NEGATIVE_INFINITY;

					nodeIds.forEach((id) => {
						const a = graph.getNodeAttributes(id);
						minX = Math.min(minX, Number(a.x ?? 0));
						minY = Math.min(minY, Number(a.y ?? 0));
						maxX = Math.max(maxX, Number(a.x ?? 0));
						maxY = Math.max(maxY, Number(a.y ?? 0));
					});

					const centerX = (minX + maxX) / 2;
					const centerY = (minY + maxY) / 2;
					const dims = sigma.getCamera && (sigma as any).getDimensions ? (sigma as any).getDimensions() : { width: container.clientWidth, height: container.clientHeight };
					const padX = Math.max(1, (maxX - minX) * padding);
					const padY = Math.max(1, (maxY - minY) * padding);
					const worldW = Math.max(1, maxX - minX + padX * 2);
					const worldH = Math.max(1, maxY - minY + padY * 2);
					const pixelRatio = window.devicePixelRatio || 1;
					const ratio = Math.max(worldW / (dims.width / pixelRatio), worldH / (dims.height / pixelRatio));

					sigma.getCamera().animate({ x: centerX, y: centerY, ratio }, { duration });
				} catch (e) {
					// ignore
				}
			};

			const screenToSpacePosition = (clientX: number, clientY: number) => {
				try {
					const bounds = container.getBoundingClientRect();
					const screenX = clientX - bounds.left;
					const screenY = clientY - bounds.top;
					const dims = (sigma as any).getDimensions();
					const state = sigma.getCamera().getState() as { x: number; y: number; ratio: number };
					const pixelRatio = window.devicePixelRatio || 1;
					const x = state.x + (screenX / pixelRatio - dims.width / 2) * state.ratio;
					const y = state.y + (screenY / pixelRatio - dims.height / 2) * state.ratio;
					return { x, y };
				} catch (e) {
					return null;
				}
			};

			const nudgeGraphLayout = (frames = INITIAL_BOOST_FRAMES) => {
				if (forceLayoutRef.current && typeof forceLayoutRef.current.start === 'function') {
					try {
						// Force worker controls itself; calling start() re-activates it if stopped
						forceLayoutRef.current.start();
					} catch (e) {}
				} else {
					startMotionBoost(frames);
				}
			};

			// Attach a small debug/compat API for programmatic control during migration
			// Consumers can call window.__SIGMA_API.fitView(), .screenToSpacePosition(x,y), .nudgeGraphLayout()
			try {
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				(window as any).__SIGMA_API = { fitView, screenToSpacePosition, nudgeGraphLayout };
			} catch (e) {}

			const animate = () => {
				// If a dedicated spring layout worker is running, skip the local ForceAtlas animation
				if (!active || !motionEnabled || forceLayoutRef.current) {
					return;
				}

				if (motionBoostFramesRef.current > 0) {
					const fa2Settings = {
						...forceAtlas2.inferSettings(graph),
						...motionSettingsRef.current,
					} as Record<string, unknown>;

					forceAtlas2.assign(graph, {
						iterations: 1,
						settings: fa2Settings,
						getEdgeWeight: 'weight',
					});

					if (stabilizationRef.current) {
						resolveGraphOverlaps(graph, collisionPaddingRef.current, collisionPassesRef.current);
					}

					sigma.refresh();
					motionBoostFramesRef.current -= 1;
				}

				animationFrameRef.current = window.requestAnimationFrame(animate);
			};

			startMotionBoost();
			animationFrameRef.current = window.requestAnimationFrame(animate);
		};

		void mountSigma();

		return () => {
			active = false;
			if (animationFrameRef.current !== null) {
				window.cancelAnimationFrame(animationFrameRef.current);
				animationFrameRef.current = null;
			}
			localSigma?.kill();
			try {
				// remove debug/compat API
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				if ((window as any).__SIGMA_API) delete (window as any).__SIGMA_API;
			} catch (e) {}
			sigmaRef.current = null;
			graphRef.current = null;
		};
	}, [dataset, motionEnabled, startMotionBoost]);

	// Wire WASM simulation bounds: compute graph extents and notify the wasm sim (if available).
	const updateWasmBounds = useCallback(
		async () => {
			const graph = graphRef.current;
			if (!graph) return;

			try {
				let minX = Number.POSITIVE_INFINITY;
				let minY = Number.POSITIVE_INFINITY;
				let maxX = Number.NEGATIVE_INFINITY;
				let maxY = Number.NEGATIVE_INFINITY;

				graph.forEachNode((nodeId, attrs) => {
					const x = Number(attrs.x ?? 0);
					const y = Number(attrs.y ?? 0);
					const size = Number(attrs.size ?? 0);
					minX = Math.min(minX, x - size * 1.2);
					minY = Math.min(minY, y - size * 1.2);
					maxX = Math.max(maxX, x + size * 1.2);
					maxY = Math.max(maxY, y + size * 1.2);
				});

				if (!isFinite(minX) || !isFinite(minY) || !isFinite(maxX) || !isFinite(maxY)) {
					return;
				}

				// add a small padding so nodes aren't exactly on the edge
				const padX = Math.max(20, (maxX - minX) * 0.06);
				const padY = Math.max(20, (maxY - minY) * 0.06);
				minX -= padX;
				minY -= padY;
				maxX += padX;
				maxY += padY;

				// Notify wasm sim (no-op if module isn't available)
				await setBounds(minX, minY, maxX, maxY);
				// 1 corresponds to BoundaryMode::Clamp from the wasm enum
				await setBoundaryMode(1);
			} catch (e) {
				// ignore failures — wasm may not be present in every environment
			}
		},
		[
			/* graphRef only */
		],
	);

	useEffect(() => {
		let ro: ResizeObserver | null = null;
		let mounted = true;

		// Attempt to eagerly load the wasm module if it's available and update bounds
		void loadWasmSim().then(() => {
			if (!mounted) return;
			void updateWasmBounds();
		});

		// Observe container resize to keep wasm bounds in sync
		if (typeof ResizeObserver !== 'undefined' && containerRef.current) {
			ro = new ResizeObserver(() => {
				void updateWasmBounds();
			});
			ro.observe(containerRef.current);
		}

		// also run once for the current dataset
		void updateWasmBounds();

		return () => {
			mounted = false;
			if (ro) ro.disconnect();
			// clear bounds when unmounting so wasm simulation no longer clamps
			void clearBounds();
		};
	}, [dataset, updateWasmBounds]);

	// Start/stop the graphology-layout-force worker (ForceSupervisor) when user toggles springMotionEnabled
	useEffect(() => {
		let mounted = true;
		let layoutInstance: any = null;

		const startForceWorker = async () => {
			if (!springMotionEnabled) return;
			const graph = graphRef.current;
			if (!graph) return;

			try {
				const module = await import('graphology-layout-force/worker');
				const ForceSupervisor = (module && (module.default || module)) as any;
				layoutInstance = new ForceSupervisor(graph);
				forceLayoutRef.current = layoutInstance;
				layoutInstance.start();
			} catch (e) {
				// swallow; package may not be installed in this environment
				forceLayoutRef.current = null;
			}
		};

		if (springMotionEnabled) {
			void startForceWorker();
		} else {
			if (forceLayoutRef.current) {
				try {
					forceLayoutRef.current.kill();
				} catch (e) {}
				forceLayoutRef.current = null;
			}
		}

		return () => {
			mounted = false;
			if (layoutInstance && typeof layoutInstance.kill === 'function') {
				try {
					layoutInstance.kill();
				} catch (e) {}
			}
			forceLayoutRef.current = null;
		};
	}, [springMotionEnabled]);

	useEffect(() => {
		const sigma = sigmaRef.current;
		const graph = graphRef.current;
		if (!sigma || !graph || !selectedNodeId || !graph.hasNode(selectedNodeId)) {
			return;
		}

		// If selection was from a click and user prefers no view motion, skip camera animation
		if (selectionModeRef.current === 'click-no-motion') {
			selectionModeRef.current = 'programmatic';
			return;
		}

		const node = graph.getNodeAttributes(selectedNodeId);
		sigma.getCamera().animate(
			{
				x: node.x,
				y: node.y,
				ratio: 0.35,
			},
			{ duration: 500 },
		);

		selectionModeRef.current = 'programmatic';
	}, [selectedNodeId]);

	// Update node colors on selection changes without remounting the sigma renderer
	useEffect(() => {
		const graph = graphRef.current;
		const sigma = sigmaRef.current;
		if (!graph || !sigma) {
			return;
		}

		const prevId = prevSelectedNodeIdRef.current;
		if (prevId && graph.hasNode(prevId) && prevId !== selectedNodeId) {
			const prevMeta = dataset.nodeById.get(prevId);
			if (prevMeta) {
				graph.mergeNodeAttributes(prevId, { color: getNodeColor(prevMeta, false) });
			}
		}

		if (selectedNodeId && graph.hasNode(selectedNodeId)) {
			const newMeta = dataset.nodeById.get(selectedNodeId);
			if (newMeta) {
				graph.mergeNodeAttributes(selectedNodeId, { color: getNodeColor(newMeta, true) });
			}
		}

		sigma.refresh();

		prevSelectedNodeIdRef.current = selectedNodeId;
	}, [selectedNodeId, dataset]);

	const handleSearchSubmit = useCallback(
		async (event: React.FormEvent<HTMLFormElement>) => {
			event.preventDefault();

			if (isSearchingUpstream) {
				return;
			}

			const normalizedQuery = searchQuery.trim().toLowerCase();
			if (!normalizedQuery) {
				setStatusMessage('Enter a name, firm, or CRD/SEC# to search the Sigma trial graph.');
				searchInputRef.current?.focus();
				return;
			}

			setIsSearchingUpstream(true);
			setStatusMessage(`Searching cache/API for “${normalizedQuery}” in Sigma trial…`);

			try {
				const response = await fetch(`/api/finra/search?query=${encodeURIComponent(normalizedQuery)}`);
				const remoteResult = (await response.json()) as RemoteGraphSearchResult;

				if (!response.ok) {
					throw new Error(remoteResult.message || `Lookup failed with status ${response.status}.`);
				}

				if (!remoteResult.primaryMatchId || remoteResult.nodes.length === 0) {
					setStatusMessage(remoteResult.message);
					return;
				}

				let nextDataset = mergeGraphDataset(dataset, { nodes: remoteResult.nodes, links: remoteResult.links });
				const inferred = inferRelatedGraphFromDetails(nextDataset, remoteResult.primaryMatchId);
				if (inferred.nodes.length > 0 || inferred.links.length > 0) {
					nextDataset = mergeGraphDataset(nextDataset, inferred);
				}

				selectionModeRef.current = 'search';
				setDataset(nextDataset);
				setSelectedNodeId(remoteResult.primaryMatchId);
				setSearchQuery('');
				setStatusMessage(`${remoteResult.message} Sigma layout refreshed with only a small settling motion.`);
				startMotionBoost(16);
			} catch (error) {
				const message = error instanceof Error ? error.message : 'Unknown search failure.';
				setStatusMessage(`Sigma trial search failed: ${message}`);
			} finally {
				setIsSearchingUpstream(false);
				searchInputRef.current?.focus();
			}
		},
		[dataset, isSearchingUpstream, searchQuery, startMotionBoost],
	);

	const handleReset = useCallback(() => {
		selectionModeRef.current = 'reset';
		setDataset(createGraphDataset());
		setSelectedNodeId(null);
		setStatusMessage('Sigma trial reset to the seeded graph with very little movement.');
		startMotionBoost(14);
	}, [startMotionBoost]);

	return (
		<div className='min-h-screen bg-slate-950 text-slate-100'>
			<header className='border-b border-white/10 bg-slate-950/85 backdrop-blur-xl'>
				<div className='mx-auto flex max-w-400 flex-wrap items-center justify-between gap-4 px-4 py-4 lg:px-6'>
					<div>
						<h1 className='text-2xl font-semibold tracking-[0.24em] text-white'>{regulatorLabel} · SIGMA TRIAL</h1>
						<p className='mt-1 text-xs text-slate-400'>WebGL renderer experiment focused on more readable motion.</p>
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
							{isSearchingUpstream ? 'Searching…' : 'Fetch Nodes'}
						</button>
					</form>
				</div>
			</header>

			<div className='mx-auto grid min-h-[calc(100vh-88px)] max-w-400 grid-cols-1 gap-0 lg:grid-cols-[340px_minmax(0,1fr)]'>
				<aside className='border-b border-white/10 bg-slate-950/70 p-4 lg:border-b-0 lg:border-r'>
					<div className='space-y-4'>
						<div className='rounded-2xl border border-white/10 bg-white/5 p-4'>
							<div className='mb-3 text-sm font-semibold text-white'>Renderer controls</div>
							<div className='flex flex-wrap gap-2'>
								<button
									className={`rounded-full px-3 py-1.5 text-xs font-medium ${motionEnabled ? 'bg-sky-400 text-slate-950' : 'border border-white/10 bg-white/5 text-slate-200'}`}
									onClick={() => setMotionEnabled((current) => !current)}
									type='button'>
									{motionEnabled ? 'Pause motion' : 'Resume motion'}
								</button>
								<button
									className='rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-slate-200'
									onClick={() => {
										startMotionBoost(reheatFrames);
										setStatusMessage('Sigma layout gently reheated.');
									}}
									type='button'>
									Reheat
								</button>
								<button
									className='rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-slate-200'
									onClick={handleReset}
									type='button'>
									Reset
								</button>
							</div>

							{/* Motion & stabilization quick controls */}
							<div className='mt-3 flex items-center justify-between gap-3'>
								<button
									className={`rounded-full px-3 py-1.5 text-xs font-medium ${stabilizationEnabled ? 'bg-emerald-400 text-slate-950' : 'border border-white/10 bg-white/5 text-slate-200'}`}
									onClick={() => setStabilizationEnabled((s) => !s)}
									type='button'>
									{stabilizationEnabled ? 'Stabilization: On' : 'Stabilization: Off'}
								</button>

								<button
									className={`rounded-full px-3 py-1.5 text-xs font-medium ${selectWithoutViewMotion ? 'bg-violet-400 text-slate-950' : 'border border-white/10 bg-white/5 text-slate-200'}`}
									onClick={() => setSelectWithoutViewMotion((s) => !s)}
									type='button'>
									{selectWithoutViewMotion ? 'Select: No view motion' : 'Select: View motion'}
								</button>

								<button
									className={`rounded-full px-3 py-1.5 text-xs font-medium ${springMotionEnabled ? 'bg-amber-400 text-slate-950' : 'border border-white/10 bg-white/5 text-slate-200'}`}
									onClick={() => setSpringMotionEnabled((s) => !s)}
									type='button'>
									{springMotionEnabled ? 'Spring motion: On' : 'Spring motion: Off'}
								</button>

								<div className='flex items-center gap-2 text-xs text-slate-300'>
									<label className='whitespace-nowrap'>Reheat frames</label>
									<input
										type='range'
										min={0}
										max={60}
										value={reheatFrames}
										onChange={(e) => setReheatFrames(Number(e.target.value))}
									/>
									<div className='w-8 text-right text-xs text-slate-200'>{reheatFrames}</div>
								</div>
							</div>

							{/* Advanced tuning */}
							<details className='mt-3'>
								<summary className='cursor-pointer text-xs text-slate-200'>Motion tuning</summary>
								<div className='mt-2 space-y-2 text-xs text-slate-300'>
									<div className='flex items-center justify-between gap-3'>
										<label className='whitespace-nowrap'>Gravity</label>
										<input
											type='range'
											min={0}
											max={1}
											step={0.01}
											value={Number(motionSettingsState.gravity)}
											onChange={(e) => setMotionSettingsState((p) => ({ ...p, gravity: Number(e.target.value) }))}
										/>
										<div className='w-10 text-right text-slate-200'>{Number(motionSettingsState.gravity).toFixed(2)}</div>
									</div>

									<div className='flex items-center justify-between gap-3'>
										<label className='whitespace-nowrap'>SlowDown</label>
										<input
											type='range'
											min={1}
											max={40}
											step={1}
											value={Number(motionSettingsState.slowDown)}
											onChange={(e) => setMotionSettingsState((p) => ({ ...p, slowDown: Number(e.target.value) }))}
										/>
										<div className='w-10 text-right text-slate-200'>{Number(motionSettingsState.slowDown)}</div>
									</div>

									<div className='flex items-center justify-between gap-3'>
										<label className='whitespace-nowrap'>Scaling</label>
										<input
											type='range'
											min={0}
											max={100}
											step={1}
											value={Number(motionSettingsState.scalingRatio)}
											onChange={(e) => setMotionSettingsState((p) => ({ ...p, scalingRatio: Number(e.target.value) }))}
										/>
										<div className='w-10 text-right text-slate-200'>{Number(motionSettingsState.scalingRatio)}</div>
									</div>

									<div className='flex items-center justify-between gap-3'>
										<label className='whitespace-nowrap'>Edge weight</label>
										<input
											type='range'
											min={0}
											max={3}
											step={0.01}
											value={Number(motionSettingsState.edgeWeightInfluence)}
											onChange={(e) => setMotionSettingsState((p) => ({ ...p, edgeWeightInfluence: Number(e.target.value) }))}
										/>
										<div className='w-10 text-right text-slate-200'>{Number(motionSettingsState.edgeWeightInfluence).toFixed(2)}</div>
									</div>

									<div className='flex items-center gap-2'>
										<button
											className={`rounded-full px-2 py-1 text-xs font-medium ${motionSettingsState.adjustSizes ? 'bg-sky-400 text-slate-950' : 'border border-white/10 bg-white/5 text-slate-300'}`}
											onClick={() => setMotionSettingsState((p) => ({ ...p, adjustSizes: !p.adjustSizes }))}
											type='button'>
											{motionSettingsState.adjustSizes ? 'Adjust sizes' : 'Adjust sizes off'}
										</button>

										<button
											className={`rounded-full px-2 py-1 text-xs font-medium ${motionSettingsState.barnesHutOptimize ? 'bg-sky-400 text-slate-950' : 'border border-white/10 bg-white/5 text-slate-300'}`}
											onClick={() => setMotionSettingsState((p) => ({ ...p, barnesHutOptimize: !p.barnesHutOptimize }))}
											type='button'>
											{motionSettingsState.barnesHutOptimize ? 'Barnes-Hut' : 'Barnes-Hut off'}
										</button>

										<button
											className={`rounded-full px-2 py-1 text-xs font-medium ${motionSettingsState.linLogMode ? 'bg-sky-400 text-slate-950' : 'border border-white/10 bg-white/5 text-slate-300'}`}
											onClick={() => setMotionSettingsState((p) => ({ ...p, linLogMode: !p.linLogMode }))}
											type='button'>
											{motionSettingsState.linLogMode ? 'LinLog' : 'LinLog off'}
										</button>
									</div>

									<div className='flex items-center justify-between gap-3'>
										<label className='whitespace-nowrap'>BH theta</label>
										<input
											type='range'
											min={0}
											max={1}
											step={0.01}
											value={Number(motionSettingsState.barnesHutTheta)}
											onChange={(e) => setMotionSettingsState((p) => ({ ...p, barnesHutTheta: Number(e.target.value) }))}
										/>
										<div className='w-10 text-right text-slate-200'>{Number(motionSettingsState.barnesHutTheta).toFixed(2)}</div>
									</div>

									<div className='flex items-center gap-2'>
										<label className='whitespace-nowrap text-slate-400'>Collision padding</label>
										<input
											type='range'
											min={0}
											max={8}
											step={0.1}
											value={collisionPadding}
											onChange={(e) => setCollisionPadding(Number(e.target.value))}
										/>
										<div className='w-10 text-right text-slate-200'>{collisionPadding.toFixed(1)}</div>
									</div>

									<div className='flex items-center gap-2'>
										<label className='whitespace-nowrap text-slate-400'>Collision passes</label>
										<input
											type='range'
											min={1}
											max={40}
											step={1}
											value={collisionPasses}
											onChange={(e) => setCollisionPasses(Number(e.target.value))}
										/>
										<div className='w-10 text-right text-slate-200'>{collisionPasses}</div>
									</div>
								</div>
							</details>
							<p className='mt-3 text-xs leading-5 text-slate-400'>{statusMessage}</p>
						</div>

						<div className='rounded-2xl border border-white/10 bg-white/5 p-4'>
							<div className='mb-2 text-sm font-semibold text-white'>Displayed</div>
							<div className='text-sm text-slate-300'>
								{displayedStats.people} People · {displayedStats.firms} Firms · {displayedStats.links} Links
							</div>
						</div>

						<div className='rounded-2xl border border-white/10 bg-white/5 p-4'>
							{selectedNode ?
								<>
									<div className='text-xl font-semibold text-white'>{selectedNode.title}</div>
									<div className='mt-1 text-sm text-slate-300'>{selectedNode.identifierLine}</div>
									<div className='mt-3 text-sm text-slate-200'>{selectedNode.summary}</div>
									<div className='mt-3 text-xs uppercase tracking-[0.22em] text-slate-500'>{getKindLabel(selectedNode.kind)}</div>
								</>
							:	<div className='text-sm text-slate-300'>Click a node in the Sigma canvas to inspect it.</div>}
						</div>
					</div>
				</aside>

				<main className='relative min-h-[70vh]'>
					<div
						className='absolute inset-0'
						ref={containerRef}
					/>
				</main>
			</div>
		</div>
	);
}
