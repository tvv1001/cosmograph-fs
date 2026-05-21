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

function buildSigmaGraph(dataset: GraphDataset, selectedNodeId: string | null): Graph<SigmaGraphNodeAttributes, SigmaGraphEdgeAttributes> {
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

	resolveGraphOverlaps(graph);

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
	const containerRef = useRef<HTMLDivElement>(null);
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

			const graph = buildSigmaGraph(dataset, selectedNodeId);
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

			const clickNodeHandler = (payload?: unknown) => {
				const nodeId = typeof payload === 'object' && payload !== null && 'node' in payload ? String((payload as { node: string }).node) : null;
				if (!nodeId) {
					return;
				}

				setSelectedNodeId(nodeId);
				startMotionBoost(8);
			};

			const clickStageHandler = () => {
				setSelectedNodeId(null);
			};

			sigma.on('clickNode', clickNodeHandler);
			sigma.on('clickStage', clickStageHandler);

			const fa2Settings = {
				...forceAtlas2.inferSettings(graph),
				...MOTION_SETTINGS,
			};

			const animate = () => {
				if (!active || !motionEnabled) {
					return;
				}

				if (motionBoostFramesRef.current > 0) {
					forceAtlas2.assign(graph, {
						iterations: 1,
						settings: fa2Settings,
						getEdgeWeight: 'weight',
					});
					resolveGraphOverlaps(graph);
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
			sigmaRef.current = null;
			graphRef.current = null;
		};
	}, [dataset, motionEnabled, selectedNodeId, startMotionBoost]);

	useEffect(() => {
		const sigma = sigmaRef.current;
		const graph = graphRef.current;
		if (!sigma || !graph || !selectedNodeId || !graph.hasNode(selectedNodeId)) {
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
	}, [selectedNodeId]);

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
										startMotionBoost(16);
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
