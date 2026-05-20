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
	revealSearchResults,
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

const COSMOGRAPH_FIT_VIEW_PADDING = 0.14;

// Pure function to generate a consistent pseudo-random offset based on a string seed (like an ID)
function getPseudoRandomOffset(seedString: string, range: number): number {
	let hash = 0;
	for (let i = 0; i < seedString.length; i++) {
		hash = (Math.imul(31, hash) + seedString.charCodeAt(i)) | 0;
	}
	// Convert hash to a deterministic value between -range and +range
	return ((Math.abs(hash) % 10000) / 10000 - 0.5) * range * 2;
}

export default function GraphView() {
	const [dataset, setDataset] = useState<GraphDataset>(() => createGraphDataset());
	const regulatorSchema = DEFAULT_REGULATOR_SCHEMA;
	const regulatorLabel = regulatorSchema['search-results']['x-site-source'];
	const graphRef = useRef<CosmographRef>(undefined);

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

	const visibleGraph = useMemo(() => projectGraphData(dataset, visibleNodeIds), [dataset, visibleNodeIds]);
	const selectedNode = selectedNodeId ? (dataset.nodeById.get(selectedNodeId) ?? null) : null;
	const activeNodeId = selectedNodeId;
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
				.map((link) => getLinkIdentityKey(link)),
		);
	}, [activeNodeId, highlightedNodeIds, traceMode, visibleGraph.links]);

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

	const appendLog = useCallback((entry: string) => {
		setSelectionLog((currentEntries) => [entry, ...currentEntries].slice(0, 10));
	}, []);

	const hydrateNodeRelationships = useCallback((baseDataset: GraphDataset, nodeId: string) => {
		const inferredPayload = inferRelatedGraphFromDetails(baseDataset, nodeId);
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
		const points: CosmographNode[] = visibleGraph.nodes.map((node, index) => {
			const isHighlighted = highlightedNodeIds.has(node.id);
			const faded = traceMode && selectedNodeId && !isHighlighted;
			const baseColor = isHighlighted ? dataset.visual.neighborNodeColor : dataset.visual.nodeColors[node.kind];
			const graphColor =
				selectedNodeId === node.id ? dataset.visual.activeNodeColor
				: faded ? 'rgba(71, 85, 105, 0.28)'
				: baseColor;

			// Pure deterministic fallback positions if x/y aren't provided by the dataset
			const initialX = getPseudoRandomOffset(`${node.id}-x`, 10);
			const initialY = getPseudoRandomOffset(`${node.id}-y`, 10);

			return {
				id: node.id,
				pointIndex: index,
				label: node.label,
				title: node.title,
				kind: node.kind,
				degreeHint: node.degreeHint,
				graphColor,
				graphSize: node.size,
				graphLabelWeight: Math.max(
					1,
					node.degreeHint +
						(selectedNodeId === node.id ? 24
						: isHighlighted ? 10
						: 0),
				),
				x: node.x ?? initialX,
				y: node.y ?? initialY,
			};
		});

		const pointIndexByNodeId = new Map(points.map((node, index) => [node.id, index]));

		const links: CosmographLink[] = visibleGraph.links.map((link) => {
			const isHighlighted = highlightedLinkIds.has(getLinkIdentityKey(link));
			const source = getEndpointId(link.source);
			const target = getEndpointId(link.target);
			const faded = traceMode && selectedNodeId && !(highlightedNodeIds.has(source) && highlightedNodeIds.has(target));
			const relationshipVisual = getRelationshipVisual(link.relationship);

			return {
				source,
				target,
				sourceIndex: pointIndexByNodeId.get(source) ?? 0,
				targetIndex: pointIndexByNodeId.get(target) ?? 0,
				weight: link.weight,
				relationship: link.relationship,
				graphColor:
					isHighlighted ? relationshipVisual.highlightColor
					: faded ? 'rgba(71, 85, 105, 0.12)'
					: relationshipVisual.color,
				graphWidth: isHighlighted ? Math.max(dataset.visual.activeLinkWidth, relationshipVisual.width + 0.4) : relationshipVisual.width + ((link.weight ?? 1) - 1) * 0.18,
				graphStrength: dataset.force.linkStrength + relationshipVisual.strengthDelta + ((link.weight ?? 1) - 1) * 0.02,
			};
		});

		return { points, links };
	}, [dataset.force.linkStrength, dataset.visual, highlightedLinkIds, highlightedNodeIds, selectedNodeId, traceMode, visibleGraph.links, visibleGraph.nodes]);

	const nodeIndexById = useMemo(() => new Map(cosmographGraph.points.map((node, index) => [node.id, index])), [cosmographGraph.points]);

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

			graph.selectPoint(nodeIndex, false, false);
			graph.setFocusedPoint(nodeIndex);
			graph.zoomToPoint(nodeIndex, dataset.viewport.focusDurationMs, dataset.force.focusZoom, true);
		},
		[dataset.force.focusZoom, dataset.viewport.focusDurationMs, nodeIndexById],
	);

	useEffect(() => {
		const graph = graphRef.current;
		if (!graph) {
			return;
		}

		if (selectedNodeId) {
			centerOnNode(selectedNodeId);
			return;
		}

		graph.unselectAllPoints();
		graph.fitView(dataset.viewport.fitViewDurationMs, COSMOGRAPH_FIT_VIEW_PADDING);
	}, [centerOnNode, dataset.viewport.fitViewDurationMs, selectedNodeId, visibleGraph.links.length, visibleGraph.nodes.length]);

	const handleNodeSelection = useCallback(
		(nodeId: string) => {
			const typedNode = dataset.nodeById.get(nodeId);
			if (!typedNode) {
				return;
			}

			const hydration = hydrateNodeRelationships(dataset, typedNode.id);
			const nextDataset = hydration.dataset;
			if (hydration.addedNodeCount > 0 || hydration.addedLinkCount > 0) {
				setDataset(nextDataset);
			}

			setVisibleNodeIds((currentVisibleNodeIds) => {
				const nextVisibleNodeIds = new Set(currentVisibleNodeIds);
				for (const expandedNodeId of expandSelection(nextDataset, typedNode.id)) {
					nextVisibleNodeIds.add(expandedNodeId);
				}
				return nextVisibleNodeIds;
			});
			setSelectedNodeId(typedNode.id);
			setMenuOpen(true);
			setShowInfo(true);
			setStatusMessage(
				hydration.addedNodeCount > 0 ? `Selected ${typedNode.title}. Added ${hydration.addedNodeCount} related nodes from detail sections.` : `Selected ${typedNode.title}.`,
			);
			appendLog(
				hydration.addedNodeCount > 0 ? `Selected ${typedNode.title} and expanded ${hydration.addedNodeCount} detail-derived relationships.` : `Selected ${typedNode.title}`,
			);
		},
		[appendLog, dataset, hydrateNodeRelationships],
	);

	const handleBackgroundClick = useCallback(() => {
		setSelectedNodeId(null);
		setStatusMessage('Highlight cleared.');
		graphRef.current?.unselectAllPoints();
		graphRef.current?.fitView(dataset.viewport.fitViewDurationMs, COSMOGRAPH_FIT_VIEW_PADDING);
	}, [dataset.viewport.fitViewDurationMs]);

	const handleSearchSubmit = useCallback(
		async (event: React.FormEvent<HTMLFormElement>) => {
			event.preventDefault();
			const result = revealSearchResults(dataset, visibleNodeIds, searchQuery);
			if (result.primaryMatchId) {
				const hydration = hydrateNodeRelationships(dataset, result.primaryMatchId);
				const nextDataset = hydration.dataset;
				if (hydration.addedNodeCount > 0 || hydration.addedLinkCount > 0) {
					setDataset(nextDataset);
				}

				const nextVisibleNodeIds = new Set(visibleNodeIds);
				for (const expandedNodeId of expandSelection(nextDataset, result.primaryMatchId)) nextVisibleNodeIds.add(expandedNodeId);
				setVisibleNodeIds(nextVisibleNodeIds);
				setStatusMessage(hydration.addedNodeCount > 0 ? `${result.message} Added ${hydration.addedNodeCount} detail-derived nodes.` : result.message);

				setSelectedNodeId(result.primaryMatchId);
				setMenuOpen(true);
				setShowInfo(true);
				appendLog(`Searched “${result.query}” and surfaced ${result.matchedNodeIds.length} matching nodes.`);
				return;
			}

			if (!result.query) {
				setVisibleNodeIds(result.visibleNodeIds);
				setStatusMessage(result.message);
				return;
			}

			setStatusMessage(`No local matches for “${result.query}”. Checking FINRA/SEC APIs…`);
			appendLog(`Searched “${result.query}” with no local matches. Checking upstream APIs.`);
			setIsSearchingUpstream(true);

			try {
				const response = await fetch(`/api/finra/search?query=${encodeURIComponent(result.query)}`);
				const remoteResult = (await response.json()) as RemoteGraphSearchResult;

				if (!response.ok) {
					throw new Error(remoteResult.message || `Lookup failed with status ${response.status}.`);
				}

				if (!remoteResult.primaryMatchId || remoteResult.nodes.length === 0) {
					setStatusMessage(remoteResult.message);
					appendLog(`No upstream matches found for “${result.query}”.`);
					return;
				}

				const mergedDataset = mergeGraphDataset(dataset, { nodes: remoteResult.nodes, links: remoteResult.links });
				const hydration = hydrateNodeRelationships(mergedDataset, remoteResult.primaryMatchId);
				const nextDataset = hydration.dataset;
				const nextVisibleNodeIds = new Set(visibleNodeIds);
				for (const matchedNodeId of remoteResult.matchedNodeIds) {
					for (const expandedNodeId of expandSelection(nextDataset, matchedNodeId)) nextVisibleNodeIds.add(expandedNodeId);
				}

				setDataset(nextDataset);
				setVisibleNodeIds(nextVisibleNodeIds);
				setSelectedNodeId(remoteResult.primaryMatchId);
				setMenuOpen(true);
				setShowInfo(true);
				setStatusMessage(hydration.addedNodeCount > 0 ? `${remoteResult.message} Added ${hydration.addedNodeCount} detail-derived nodes.` : remoteResult.message);
				appendLog(
					remoteResult.source === 'local' ?
						`Loaded ${remoteResult.matchedNodeIds.length} cached node(s) for “${result.query}”.`
					:	`Fetched ${remoteResult.matchedNodeIds.length} upstream node(s) for “${result.query}” and saved them locally.`,
				);
			} catch (error) {
				const message = error instanceof Error ? error.message : 'Unknown search failure.';
				setStatusMessage(`Unable to fetch upstream data for “${result.query}”.`);
				appendLog(`Upstream lookup failed for “${result.query}”: ${message}`);
			} finally {
				setIsSearchingUpstream(false);
			}
		},
		[appendLog, dataset, hydrateNodeRelationships, searchQuery, visibleNodeIds],
	);

	const handleResetSession = useCallback(() => {
		setVisibleNodeIds(new Set(dataset.initialVisibleNodeIds));
		setSelectedNodeId(null);
		setTraceMode(false);
		setShowInfo(true);
		setShowLog(false);
		setIsSearchingUpstream(false);
		setSearchQuery('');
		setStatusMessage('Session reset. Select a node to explore the graph.');
		appendLog('Reset the local graph session.');
	}, [appendLog, dataset]);

	const handleReflow = useCallback(() => {
		graphRef.current?.start(dataset.force.manualReheatImpulse);
		setStatusMessage('Layout gently nudged.');
		appendLog('Reflowed the visible layout.');
	}, [appendLog, dataset.force.manualReheatImpulse]);

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
									disabled={isSearchingUpstream}
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
					<div className='absolute inset-0'>
						<CosmographCanvas
							ref={graphRef}
							className='h-full w-full'
							style={{ height: '100%', width: '100%' }}
							backgroundColor={dataset.visual.backgroundColor}
							enableSimulation={selectedNodeId !== null}
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
							simulationImpulse={selectedNodeId ? dataset.force.simulationImpulse : 0}
							pointLabelColor={dataset.visual.nodeLabelColor}
							pointLabelFontSize={13}
							onPointClick={(index) => {
								const node = cosmographGraph.points[index];
								if (node) {
									handleNodeSelection(node.id);
								}
							}}
							onLabelClick={(index) => {
								const node = cosmographGraph.points[index];
								if (node) {
									handleNodeSelection(node.id);
								}
							}}
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
