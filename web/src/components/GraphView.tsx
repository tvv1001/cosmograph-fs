'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ForceGraphMethods, ForceGraphProps, LinkObject, NodeObject } from 'react-force-graph-2d';

import {
	createGraphDataset,
	expandSelection,
	getDisplayedStats,
	getEndpointId,
	getKindLabel,
	getLinkKey,
	projectGraphData,
	revealSearchResults,
	type BadgeTone,
	type GraphDataset,
	type GraphLink,
	type GraphNode,
} from '@/lib/graph-data';

type ForceGraphComponentType = React.ComponentType<
	ForceGraphProps<GraphNode, GraphLink> & {
		ref?: React.Ref<ForceGraphMethods<GraphNode, GraphLink> | undefined>;
	}
>;

type ChargeForce = {
	strength: (strength: number | ((node: NodeObject<GraphNode>) => number)) => ChargeForce;
	distanceMax?: (distance: number) => ChargeForce;
};

type LinkForce = {
	distance: (distance: number | ((link: LinkObject<GraphNode, GraphLink>) => number)) => LinkForce;
	strength: (strength: number | ((link: LinkObject<GraphNode, GraphLink>) => number)) => LinkForce;
	iterations?: (iterations: number) => LinkForce;
};

const MIN_NODE_HIT_RADIUS_PX = 14;
const NODE_HIT_RADIUS_PADDING_PX = 6;
const MIN_NODE_LABEL_FONT_SIZE_PX = 3.5;
const NODE_LABEL_FONT_SIZE_PX = 10;
const NODE_LABEL_PADDING_PX = 4;

function getNodeLabelMetrics(node: GraphNode, globalScale: number): { fontSize: number; labelY: number; labelPadding: number } {
	const fontSize = Math.max(NODE_LABEL_FONT_SIZE_PX / globalScale, MIN_NODE_LABEL_FONT_SIZE_PX);
	const labelPadding = NODE_LABEL_PADDING_PX / globalScale;
	const labelY = (node.y ?? 0) - node.size - fontSize;

	return { fontSize, labelY, labelPadding };
}

export default function GraphView() {
	const dataset = useMemo<GraphDataset>(() => createGraphDataset(), []);
	const graphRef = useRef<ForceGraphMethods<GraphNode, GraphLink> | undefined>(undefined);
	const [ForceGraphCanvas, setForceGraphCanvas] = useState<ForceGraphComponentType | null>(null);
	const [visibleNodeIds, setVisibleNodeIds] = useState<Set<string>>(() => new Set(dataset.initialVisibleNodeIds));
	const [selectedNodeId, setSelectedNodeId] = useState<string | null>(dataset.initialNodeId);
	const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
	const [searchQuery, setSearchQuery] = useState('');
	const [statusMessage, setStatusMessage] = useState('Ready with a seeded FINRA-style graph. Search a name like “thornton”.');
	const [selectionLog, setSelectionLog] = useState<string[]>(['Loaded NEXA SECURITIES demo graph.']);
	const [showInfo, setShowInfo] = useState(true);
	const [showLog, setShowLog] = useState(false);
	const [traceMode, setTraceMode] = useState(false);
	const [showLegend, setShowLegend] = useState(false);
	const [menuOpen, setMenuOpen] = useState(true);
	const [panelPinned, setPanelPinned] = useState(true);

	const visibleGraph = useMemo(() => projectGraphData(dataset, visibleNodeIds), [dataset, visibleNodeIds]);
	const selectedNode = selectedNodeId ? (dataset.nodeById.get(selectedNodeId) ?? null) : null;
	const activeNodeId = hoveredNodeId ?? selectedNodeId;
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
		let isMounted = true;

		import('react-force-graph-2d').then((module) => {
			if (isMounted) {
				setForceGraphCanvas(() => module.default as unknown as ForceGraphComponentType);
			}
		});

		return () => {
			isMounted = false;
		};
	}, []);

	useEffect(() => {
		const graph = graphRef.current;
		if (!graph) {
			return;
		}

		const chargeForce = graph.d3Force('charge') as ChargeForce | undefined;
		chargeForce?.strength((node) => (node.isHub ? dataset.force.chargeStrength * 1.25 : dataset.force.chargeStrength));
		chargeForce?.distanceMax?.(dataset.force.linkDistance * 7);

		const linkForce = graph.d3Force('link') as LinkForce | undefined;
		linkForce?.distance((link) => dataset.force.linkDistance + ((link.weight ?? 1) - 1) * 10);
		linkForce?.strength((link) => dataset.force.linkStrength + ((link.weight ?? 1) - 1) * 0.04);
		linkForce?.iterations?.(2);

		graph.zoomToFit(dataset.viewport.fitViewDurationMs, dataset.viewport.fitViewPadding);
	}, [dataset, visibleGraph.links.length, visibleGraph.nodes.length]);

	const appendLog = useCallback((entry: string) => {
		setSelectionLog((currentEntries) => [entry, ...currentEntries].slice(0, 10));
	}, []);

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
			setVisibleNodeIds((currentVisibleNodeIds) => {
				const nextVisibleNodeIds = new Set(currentVisibleNodeIds);
				for (const nodeId of expandSelection(dataset, typedNode.id)) {
					nextVisibleNodeIds.add(nodeId);
				}
				return nextVisibleNodeIds;
			});
			setSelectedNodeId(typedNode.id);
			setMenuOpen(true);
			setShowInfo(true);
			setStatusMessage(`Selected ${typedNode.title}.`);
			appendLog(`Selected ${typedNode.title}`);
			centerOnNode(typedNode.id, { reheat: true });
		},
		[appendLog, centerOnNode, dataset],
	);

	const handleBackgroundClick = useCallback(() => {
		setSelectedNodeId(null);
		setHoveredNodeId(null);
		setStatusMessage('Highlight cleared.');
		graphRef.current?.zoomToFit(dataset.viewport.fitViewDurationMs, dataset.viewport.fitViewPadding);
	}, [dataset.viewport.fitViewDurationMs, dataset.viewport.fitViewPadding]);

	const handleSearchSubmit = useCallback(
		(event: React.FormEvent<HTMLFormElement>) => {
			event.preventDefault();
			const result = revealSearchResults(dataset, visibleNodeIds, searchQuery);
			setVisibleNodeIds(result.visibleNodeIds);
			setStatusMessage(result.message);

			if (result.primaryMatchId) {
				setSelectedNodeId(result.primaryMatchId);
				setMenuOpen(true);
				setShowInfo(true);
				centerOnNode(result.primaryMatchId);
				appendLog(`Searched “${result.query}” and surfaced ${result.matchedNodeIds.length} matching nodes.`);
			} else if (result.query) {
				appendLog(`Searched “${result.query}” with no local matches.`);
			}
		},
		[appendLog, centerOnNode, dataset, searchQuery, visibleNodeIds],
	);

	const handleResetSession = useCallback(() => {
		setVisibleNodeIds(new Set(dataset.initialVisibleNodeIds));
		setSelectedNodeId(dataset.initialNodeId);
		setHoveredNodeId(null);
		setTraceMode(false);
		setShowInfo(true);
		setShowLog(false);
		setSearchQuery('');
		setStatusMessage('Session reset to the initial firm view.');
		appendLog('Reset the local graph session.');
		graphRef.current?.zoomToFit(dataset.viewport.fitViewDurationMs, dataset.viewport.fitViewPadding);
	}, [appendLog, dataset]);

	const handleReflow = useCallback(() => {
		graphRef.current?.d3ReheatSimulation();
		setStatusMessage('Layout reheated.');
		appendLog('Reflowed the visible layout.');
	}, [appendLog]);

	const renderNode = useCallback(
		(node: NodeObject<GraphNode>, ctx: CanvasRenderingContext2D, globalScale: number) => {
			const typedNode = node as GraphNode;
			const radius = typedNode.size;
			const isHighlighted = highlightedNodeIds.has(typedNode.id);
			const faded = traceMode && selectedNodeId && !isHighlighted;
			const baseColor = isHighlighted ? dataset.visual.neighborNodeColor : dataset.visual.nodeColors[typedNode.kind];
			const fillColor = selectedNodeId === typedNode.id ? dataset.visual.activeNodeColor : baseColor;

			ctx.globalAlpha = faded ? 0.18 : 1;
			ctx.beginPath();
			ctx.arc(typedNode.x ?? 0, typedNode.y ?? 0, radius, 0, 2 * Math.PI, false);
			ctx.fillStyle = fillColor;
			ctx.fill();

			ctx.lineWidth = typedNode.isHub ? 2.5 : 1.1;
			ctx.strokeStyle = typedNode.isHub ? dataset.visual.hubRingColor : dataset.visual.nodeStrokeColor;
			ctx.stroke();

			const { fontSize, labelY, labelPadding } = getNodeLabelMetrics(typedNode, globalScale);
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

			ctx.globalAlpha = 1;
		},
		[dataset.visual, highlightedNodeIds, selectedNodeId, traceMode],
	);

	const renderNodePointerArea = useCallback(
		(node: NodeObject<GraphNode>, color: string, ctx: CanvasRenderingContext2D, globalScale: number) => {
			const typedNode = node as GraphNode;
			const minimumRadius = MIN_NODE_HIT_RADIUS_PX / globalScale;
			const paddingRadius = NODE_HIT_RADIUS_PADDING_PX / globalScale;
			const hitRadius = Math.max(typedNode.size + paddingRadius, minimumRadius);
			const shouldIncludeLabelHitArea = typedNode.id === selectedNodeId || typedNode.id === hoveredNodeId;

			ctx.beginPath();
			ctx.arc(typedNode.x ?? 0, typedNode.y ?? 0, hitRadius, 0, 2 * Math.PI, false);
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

	if (!ForceGraphCanvas) {
		return <div className='flex h-screen items-center justify-center bg-slate-950 text-white'>Loading force-directed graph...</div>;
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
					<ForceGraphCanvas
						ref={graphRef}
						graphData={visibleGraph}
						backgroundColor={dataset.visual.backgroundColor}
						nodeRelSize={1}
						nodeVal={(node) => node.size}
						nodeLabel={(node) => `${node.title} • ${getKindLabel(node.kind)} • ${node.degreeHint} connections`}
						nodeCanvasObject={renderNode}
						nodePointerAreaPaint={renderNodePointerArea}
						linkWidth={(link) =>
							highlightedLinkIds.has(getLinkKey(link as GraphLink)) ? dataset.visual.activeLinkWidth : dataset.visual.linkWidth + ((link.weight ?? 1) - 1) * 0.25
						}
						linkColor={(link) => (highlightedLinkIds.has(getLinkKey(link as GraphLink)) ? dataset.visual.activeLinkColor : dataset.visual.linkColor)}
						linkDirectionalParticles={(link) => (highlightedLinkIds.has(getLinkKey(link as GraphLink)) ? 2 : 0)}
						linkDirectionalParticleWidth={2.2}
						linkDirectionalParticleColor={() => dataset.visual.linkParticleColor}
						d3AlphaMin={dataset.force.alphaMin}
						d3AlphaDecay={dataset.force.alphaDecay}
						d3VelocityDecay={dataset.force.velocityDecay}
						warmupTicks={dataset.force.warmupTicks}
						cooldownTicks={dataset.force.cooldownTicks}
						autoPauseRedraw={false}
						onNodeHover={(node) => setHoveredNodeId(node ? String(node.id) : null)}
						onNodeClick={handleNodeClick}
						onBackgroundClick={handleBackgroundClick}
					/>

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
