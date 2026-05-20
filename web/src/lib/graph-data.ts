export type GraphNodeKind = 'firm' | 'individual';

export type IdSourceFlag = 'finra only' | 'sec only' | 'both finra_sec';

export type RelationshipKind = 'employment' | 'previous-employment' | 'control' | 'peer' | 'disclosure';

export type BadgeTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

export interface EntityBadge {
	label: string;
	tone: BadgeTone;
}

export interface EntityLink {
	label: string;
	href: string;
}

export interface EntityDetailItem {
	label: string;
	value: string;
	href?: string;
}

export interface EntityDetailSection {
	title: string;
	items?: EntityDetailItem[];
	paragraphs?: string[];
}

export interface GraphNode {
	id: string;
	label: string;
	kind: GraphNodeKind;
	degreeHint: number;
	size: number;
	isHub: boolean;
	title: string;
	identifierLine: string;
	sourceFlag?: IdSourceFlag;
	badges: EntityBadge[];
	marker: string;
	summary: string;
	subtitle?: string;
	searchText: string;
	externalLinks: EntityLink[];
	detailSections: EntityDetailSection[];
	x?: number;
	y?: number;
	vx?: number;
	vy?: number;
	fx?: number;
	fy?: number;
}

type RelationshipSectionKind = 'employment' | 'previous-employment' | 'control' | null;

export interface GraphLink {
	source: string | GraphNode;
	target: string | GraphNode;
	weight: number;
	relationship: RelationshipKind;
}

export interface ForceLayoutConfig {
	chargeStrength: number;
	linkDistance: number;
	linkStrength: number;
	simulationDecay: number;
	simulationGravity: number;
	simulationCenter: number;
	simulationRepulsion: number;
	simulationRepulsionFromMouse: number;
	simulationLinkDistanceVariation: [number, number];
	simulationFriction: number;
	simulationImpulse: number;
	manualReheatImpulse: number;
	velocityDecay: number;
	alphaDecay: number;
	alphaMin: number;
	warmupTicks: number;
	cooldownTicks: number;
	collisionPadding: number;
	neighborhoodSpread: number;
	focusZoom: number;
	reheatOnSelect: boolean;
}

export interface GraphDataset {
	graphData: {
		nodes: GraphNode[];
		links: GraphLink[];
	};
	adjacency: Map<string, Set<string>>;
	linksByNodeId: Map<string, GraphLink[]>;
	nodeById: Map<string, GraphNode>;
	force: ForceLayoutConfig;
	visual: {
		backgroundColor: string;
		nodeColors: Record<GraphNodeKind, string>;
		hubRingColor: string;
		activeNodeColor: string;
		neighborNodeColor: string;
		linkColor: string;
		activeLinkColor: string;
		linkParticleColor: string;
		linkWidth: number;
		activeLinkWidth: number;
		nodeStrokeColor: string;
		nodeLabelColor: string;
		panelBackground: string;
		panelBorder: string;
	};
	viewport: {
		fitViewPadding: number;
		fitViewDurationMs: number;
		focusDurationMs: number;
	};
	legend: Array<{ label: string; color: string; description: string }>;
	initialNodeId: string;
	initialVisibleNodeIds: string[];
}

export interface SearchRevealResult {
	query: string;
	visibleNodeIds: Set<string>;
	matchedNodeIds: string[];
	primaryMatchId: string | null;
	addedCount: number;
	message: string;
}

export interface RemoteGraphSearchResult {
	query: string;
	source: 'local' | 'external' | 'none';
	matchedNodeIds: string[];
	primaryMatchId: string | null;
	nodes: GraphNode[];
	links: GraphLink[];
	addedToLocal: boolean;
	message: string;
}

export interface DetailInferenceOptions {
	allowedRelationships?: RelationshipKind[];
}

const INITIAL_FIRM_ID = 'firm-15621';

const DEFAULT_FORCE_CONFIG: ForceLayoutConfig = {
	chargeStrength: -86,
	linkDistance: 52,
	linkStrength: 0.28,
	simulationDecay: 1800,
	simulationGravity: 0.14,
	simulationCenter: 0.28,
	simulationRepulsion: 0.54,
	simulationRepulsionFromMouse: 0,
	simulationLinkDistanceVariation: [1, 1.03],
	simulationFriction: 0.92,
	simulationImpulse: 0.16,
	manualReheatImpulse: 0.22,
	velocityDecay: 0.32,
	alphaDecay: 0.042,
	alphaMin: 0.004,
	warmupTicks: 64,
	cooldownTicks: 280,
	collisionPadding: 12,
	neighborhoodSpread: 34,
	focusZoom: 1.75,
	reheatOnSelect: false,
};

const DEFAULT_VISUAL_CONFIG = {
	backgroundColor: '#020617',
	nodeColors: {
		firm: '#38bdf8',
		individual: '#22c55e',
	} satisfies Record<GraphNodeKind, string>,
	hubRingColor: '#e0f2fe',
	activeNodeColor: '#f8fafc',
	neighborNodeColor: '#fde68a',
	linkColor: 'rgba(148, 163, 184, 0.18)',
	activeLinkColor: 'rgba(125, 211, 252, 0.96)',
	linkParticleColor: '#e0f2fe',
	linkWidth: 0.95,
	activeLinkWidth: 2.1,
	nodeStrokeColor: 'rgba(15, 23, 42, 0.92)',
	nodeLabelColor: '#e2e8f0',
	panelBackground: 'rgba(2, 6, 23, 0.88)',
	panelBorder: 'rgba(148, 163, 184, 0.12)',
};

const DEFAULT_VIEWPORT_CONFIG = {
	fitViewPadding: 110,
	fitViewDurationMs: 500,
	focusDurationMs: 650,
};

const LAST_NAMES = ['Thornton', 'Liu', 'Patel', 'Kim', 'Nguyen', 'Garcia', 'Bennett', 'Rao', 'Chen', 'Walker', 'Collins', 'Young'];
const FIRST_NAMES = [
	'Alexandra',
	'James',
	'Roy',
	'Adam',
	'Peterson',
	'Kenneth',
	'Joseph',
	'Charles',
	'Sharon',
	'Melissa',
	'Daniel',
	'Grace',
	'Oliver',
	'Priya',
	'Marcus',
	'Rina',
	'Ethan',
	'Noah',
	'Leah',
	'Iris',
];
const CITY_SUMMARIES = [
	'Brokerage Firm Regulated by FINRA (Los Angeles)',
	'Brokerage Firm Regulated by FINRA (New York)',
	'Brokerage Firm Regulated by FINRA (Chicago)',
	'Brokerage Firm Regulated by FINRA (Dallas)',
	'Brokerage Firm Regulated by FINRA (Miami)',
];

type FirmSeed = {
	id: string;
	crd: string;
	sec: string;
	name: string;
	aliases?: string[];
	summary: string;
	badges: EntityBadge[];
	details: EntityDetailSection[];
	externalLinks?: EntityLink[];
};
type PersonSeed = { id: string; crd: string; name: string; summary: string; badges: EntityBadge[]; details: EntityDetailSection[]; externalLinks?: EntityLink[] };

export function createGraphDataset(): GraphDataset {
	const nodes: GraphNode[] = [];
	const links: GraphLink[] = [];
	const linkKeys = new Set<string>();
	const degreeCounts = new Map<string, number>();

	for (const firm of getSeedFirms()) nodes.push(createFirmNode(firm));
	for (const person of getSeedPeople()) nodes.push(createPersonNode(person));
	for (const firm of createGeneratedFirms(48)) nodes.push(firm);
	for (const person of createGeneratedPeople(220)) nodes.push(person);

	const firmIds = nodes.filter((node) => node.kind === 'firm').map((node) => node.id);
	const personIds = nodes.filter((node) => node.kind === 'individual').map((node) => node.id);

	connectEmployment(links, linkKeys, degreeCounts, 'person-3004487', ['firm-15621']);
	connectEmployment(links, linkKeys, degreeCounts, 'person-4496384', ['firm-15621', 'firm-13092', 'firm-10205', 'firm-42867']);
	connectEmployment(links, linkKeys, degreeCounts, 'person-2811544', ['firm-13092']);
	connectEmployment(links, linkKeys, degreeCounts, 'person-6759010', ['firm-10205']);
	connectEmployment(links, linkKeys, degreeCounts, 'person-7547544', ['firm-42867']);
	connectEmployment(links, linkKeys, degreeCounts, 'person-1853032', ['firm-10908']);
	connectEmployment(links, linkKeys, degreeCounts, 'person-2186376', ['firm-13249']);
	connectEmployment(links, linkKeys, degreeCounts, 'person-4297530', ['firm-15473']);
	connectEmployment(links, linkKeys, degreeCounts, 'person-4851680', ['firm-24510']);
	connectEmployment(links, linkKeys, degreeCounts, 'person-5164583', ['firm-29114']);
	connectEmployment(links, linkKeys, degreeCounts, 'person-5368109', ['firm-8842']);
	connectEmployment(links, linkKeys, degreeCounts, 'person-5573647', ['firm-16735']);
	connectEmployment(links, linkKeys, degreeCounts, 'person-7736566', ['firm-42180']);
	connectEmployment(links, linkKeys, degreeCounts, 'person-1413678', ['firm-7748']);

	for (let index = 0; index < personIds.length; index += 1) {
		const personId = personIds[index];
		if (/^person-(3004487|4496384|2811544|6759010|7547544|1853032|2186376|4297530|4851680|5164583|5368109|5573647|7736566|1413678)$/.test(personId)) {
			continue;
		}

		connectEmployment(links, linkKeys, degreeCounts, personId, [firmIds[index % firmIds.length]]);
		if (index % 4 === 0) connectEmployment(links, linkKeys, degreeCounts, personId, [firmIds[(index * 5 + 3) % firmIds.length]]);
		if (index % 9 === 0) addLink(links, degreeCounts, linkKeys, personId, firmIds[(index * 7 + 11) % firmIds.length], 1, 'disclosure');
	}

	for (let index = 1; index < firmIds.length; index += 5) addLink(links, degreeCounts, linkKeys, firmIds[index], firmIds[(index + 7) % firmIds.length], 1, 'peer');

	for (const node of nodes) {
		node.degreeHint = degreeCounts.get(node.id) ?? 0;
		node.size = getNodeSize(node.degreeHint, node.isHub, node.kind);
	}

	const graphData = { nodes, links };
	const adjacency = createAdjacencyMap(links);
	const dataset: GraphDataset = {
		graphData,
		adjacency,
		linksByNodeId: createLinksByNodeId(links),
		nodeById: new Map(nodes.map((node) => [node.id, node])),
		force: DEFAULT_FORCE_CONFIG,
		visual: DEFAULT_VISUAL_CONFIG,
		viewport: DEFAULT_VIEWPORT_CONFIG,
		legend: [
			{ label: 'Firm', color: DEFAULT_VISUAL_CONFIG.nodeColors.firm, description: 'Broker-dealers, advisers, and related firms' },
			{ label: 'Person', color: DEFAULT_VISUAL_CONFIG.nodeColors.individual, description: 'Registered people, officers, and owners' },
			{ label: 'Current emp/reg', color: 'rgba(96, 165, 250, 0.82)', description: 'Current employment or registration relationship' },
			{ label: 'Previous emp/reg', color: 'rgba(203, 213, 225, 0.42)', description: 'Previous employment or prior registration relationship' },
			{ label: 'Controls', color: 'rgba(248, 113, 113, 0.92)', description: 'Control positions, direct owners, and executive officers' },
			{ label: 'Has disclosures', color: 'rgba(251, 191, 36, 0.72)', description: 'Disclosure-related relationship or warning signal' },
			{ label: 'Highlighted path', color: DEFAULT_VISUAL_CONFIG.activeLinkColor, description: 'Active selection and nearby links' },
		],
		initialNodeId: INITIAL_FIRM_ID,
		initialVisibleNodeIds: [],
	};

	dataset.initialVisibleNodeIds = Array.from(expandSelection(dataset, INITIAL_FIRM_ID));
	return dataset;
}

export function projectGraphData(dataset: GraphDataset, visibleNodeIds: Set<string>): { nodes: GraphNode[]; links: GraphLink[] } {
	return {
		nodes: dataset.graphData.nodes.filter((node) => visibleNodeIds.has(node.id)),
		links: dataset.graphData.links.filter((link) => visibleNodeIds.has(getEndpointId(link.source)) && visibleNodeIds.has(getEndpointId(link.target))),
	};
}

export function expandSelection(dataset: GraphDataset, nodeId: string): Set<string> {
	const selectedNode = dataset.nodeById.get(nodeId);
	const visibleNodeIds = new Set<string>([nodeId]);
	if (!selectedNode) return visibleNodeIds;

	const connectedLinks = dataset.linksByNodeId.get(nodeId) ?? [];

	if (selectedNode.kind === 'firm') {
		for (const link of connectedLinks) {
			if (link.relationship !== 'employment') {
				continue;
			}

			const employeeId = getOppositeEndpointId(link, nodeId);
			if (!employeeId) {
				continue;
			}

			const employeeNode = dataset.nodeById.get(employeeId);
			if (employeeNode?.kind === 'individual') {
				visibleNodeIds.add(employeeId);
			}
		}

		return visibleNodeIds;
	}

	for (const link of connectedLinks) {
		const neighborId = getOppositeEndpointId(link, nodeId);
		if (neighborId) {
			visibleNodeIds.add(neighborId);
		}
	}

	for (const link of connectedLinks) {
		const neighborId = getOppositeEndpointId(link, nodeId);
		if (!neighborId) {
			continue;
		}

		const neighborNode = dataset.nodeById.get(neighborId);
		if (neighborNode?.kind !== 'firm') continue;

		for (const secondDegreeLink of dataset.linksByNodeId.get(neighborId) ?? []) {
			if (secondDegreeLink.relationship !== 'employment') {
				continue;
			}

			const secondDegreeId = getOppositeEndpointId(secondDegreeLink, neighborId);
			if (secondDegreeId) {
				visibleNodeIds.add(secondDegreeId);
			}
		}
	}

	return visibleNodeIds;
}

export function revealSearchResults(dataset: GraphDataset, currentVisibleNodeIds: Set<string>, query: string): SearchRevealResult {
	const normalizedQuery = query.trim().toLowerCase();
	if (!normalizedQuery) {
		return {
			query: '',
			visibleNodeIds: new Set(currentVisibleNodeIds),
			matchedNodeIds: [],
			primaryMatchId: null,
			addedCount: 0,
			message: 'Enter a name, firm, or CRD/SEC# to expand the graph.',
		};
	}

	const matches = dataset.graphData.nodes
		.filter((node) => node.searchText.includes(normalizedQuery))
		.sort((left, right) => scoreSearchMatch(left.searchText, normalizedQuery) - scoreSearchMatch(right.searchText, normalizedQuery));

	const nextVisible = new Set(currentVisibleNodeIds);
	for (const match of matches) for (const nodeId of expandSelection(dataset, match.id)) nextVisible.add(nodeId);

	const addedCount = nextVisible.size - currentVisibleNodeIds.size;
	return {
		query: normalizedQuery,
		visibleNodeIds: nextVisible,
		matchedNodeIds: matches.map((node) => node.id),
		primaryMatchId: matches[0]?.id ?? null,
		addedCount,
		message: matches.length === 0 ? `No local matches found for "${normalizedQuery}".` : `Added ${addedCount} nodes for "${normalizedQuery}".`,
	};
}

export function getDisplayedStats(graphData: { nodes: GraphNode[]; links: GraphLink[] }): { people: number; firms: number; links: number } {
	return {
		people: graphData.nodes.filter((node) => node.kind === 'individual').length,
		firms: graphData.nodes.filter((node) => node.kind === 'firm').length,
		links: graphData.links.length,
	};
}

export function getKindLabel(kind: GraphNodeKind): string {
	return kind === 'firm' ? 'FIRM' : 'INDIVIDUAL';
}

export function getIdSourceFlag(hasFinraSource: boolean, hasSecSource: boolean): IdSourceFlag | undefined {
	if (hasFinraSource && hasSecSource) {
		return 'both finra_sec';
	}
	if (hasFinraSource) {
		return 'finra only';
	}
	if (hasSecSource) {
		return 'sec only';
	}
	return undefined;
}

export function inferRelatedGraphFromDetails(dataset: GraphDataset, nodeId: string, options?: DetailInferenceOptions): { nodes: GraphNode[]; links: GraphLink[] } {
	const sourceNode = dataset.nodeById.get(nodeId);
	if (!sourceNode) {
		return { nodes: [], links: [] };
	}

	const nextNodes = new Map<string, GraphNode>();
	const nextLinks = new Map<string, GraphLink>();

	for (const section of sourceNode.detailSections) {
		const sectionRelationshipKind = getSectionRelationshipKind(section.title);
		if (!sectionRelationshipKind || !section.items?.length) {
			continue;
		}

		if (options?.allowedRelationships && !options.allowedRelationships.includes(sectionRelationshipKind)) {
			continue;
		}

		for (const item of section.items) {
			const candidate = createRelatedNodeCandidate(dataset, sourceNode, section.title, sectionRelationshipKind, item);
			if (!candidate) {
				continue;
			}

			if (!dataset.nodeById.has(candidate.node.id)) {
				nextNodes.set(candidate.node.id, candidate.node);
			}

			if (!hasLinkWithIdentity(dataset.graphData.links, candidate.link)) {
				nextLinks.set(getLinkIdentityKey(candidate.link), candidate.link);
			}
		}
	}

	return {
		nodes: Array.from(nextNodes.values()),
		links: Array.from(nextLinks.values()),
	};
}

export function mergeGraphDataset(dataset: GraphDataset, payload: { nodes: GraphNode[]; links: GraphLink[] }): GraphDataset {
	if (payload.nodes.length === 0 && payload.links.length === 0) {
		return dataset;
	}

	const nodeById = new Map(dataset.graphData.nodes.map((node) => [node.id, node]));
	for (const node of payload.nodes) {
		const existingNode = nodeById.get(node.id);
		nodeById.set(node.id, {
			...existingNode,
			...node,
			externalLinks:
				existingNode ?
					Array.from(new Map([...existingNode.externalLinks, ...node.externalLinks].map((link) => [`${link.label}:${link.href}`, link])).values())
				:	node.externalLinks,
			detailSections: node.detailSections.length > 0 ? node.detailSections : (existingNode?.detailSections ?? []),
			searchText: `${existingNode?.searchText ?? ''} ${node.searchText}`.trim().toLowerCase(),
		});
	}

	const linkByKey = new Map(dataset.graphData.links.map((link) => [getLinkIdentityKey(link), link]));
	for (const link of payload.links) linkByKey.set(getLinkIdentityKey(link), link);

	const links = Array.from(linkByKey.values());
	const degreeCounts = new Map<string, number>();
	for (const link of links) {
		const sourceId = getEndpointId(link.source);
		const targetId = getEndpointId(link.target);
		degreeCounts.set(sourceId, (degreeCounts.get(sourceId) ?? 0) + 1);
		degreeCounts.set(targetId, (degreeCounts.get(targetId) ?? 0) + 1);
	}

	const nodes = Array.from(nodeById.values()).map((node) => {
		const degreeHint = degreeCounts.get(node.id) ?? 0;
		return {
			...node,
			degreeHint,
			size: getNodeSize(degreeHint, node.isHub, node.kind),
		};
	});

	return {
		...dataset,
		graphData: { nodes, links },
		adjacency: createAdjacencyMap(links),
		linksByNodeId: createLinksByNodeId(links),
		nodeById: new Map(nodes.map((node) => [node.id, node])),
	};
}

function getSectionRelationshipKind(sectionTitle: string): RelationshipSectionKind {
	const normalizedTitle = sectionTitle.trim().toLowerCase();
	if (/current employment|current emp\/reg|current registration/.test(normalizedTitle)) {
		return 'employment';
	}
	if (/previous employment|previous emp\/reg|former employment|prior employment/.test(normalizedTitle)) {
		return 'previous-employment';
	}
	if (/control positions|direct owners|executive officers|form bd/.test(normalizedTitle)) {
		return 'control';
	}
	return null;
}

function createRelatedNodeCandidate(
	dataset: GraphDataset,
	sourceNode: GraphNode,
	sectionTitle: string,
	relationship: Exclude<RelationshipSectionKind, null>,
	item: EntityDetailItem,
): { node: GraphNode; link: GraphLink } | null {
	const rawLabel = item.label.trim();
	if (!rawLabel) {
		return null;
	}

	const relatedKind = inferRelatedNodeKind(sourceNode, sectionTitle, rawLabel, item.value);
	const existingNode = findExistingNodeByLabel(dataset, rawLabel, relatedKind);
	const relatedNode = existingNode ?? createDerivedGraphNode(sourceNode, sectionTitle, relationship, rawLabel, item.value, relatedKind);
	if (relatedNode.id === sourceNode.id) {
		return null;
	}

	return {
		node: relatedNode,
		link: buildRelationshipLink(sourceNode, relatedNode, relationship),
	};
}

function inferRelatedNodeKind(sourceNode: GraphNode, sectionTitle: string, rawLabel: string, rawValue: string): GraphNodeKind {
	if (sourceNode.kind === 'individual') {
		return 'firm';
	}

	if (/current employment|previous employment/.test(sectionTitle.toLowerCase())) {
		return 'individual';
	}

	return looksLikeFirmEntity(rawLabel, rawValue) ? 'firm' : 'individual';
}

function findExistingNodeByLabel(dataset: GraphDataset, rawLabel: string, expectedKind: GraphNodeKind): GraphNode | null {
	const comparableTarget = normalizeComparableLabel(formatDerivedDisplayLabel(rawLabel, expectedKind));
	for (const node of dataset.graphData.nodes) {
		if (node.kind !== expectedKind) {
			continue;
		}

		if (normalizeComparableLabel(node.label) === comparableTarget) {
			return node;
		}

		if (node.subtitle && normalizeComparableLabel(node.subtitle).includes(comparableTarget)) {
			return node;
		}
	}

	return null;
}

function createDerivedGraphNode(sourceNode: GraphNode, sectionTitle: string, relationship: RelationshipKind, rawLabel: string, rawValue: string, kind: GraphNodeKind): GraphNode {
	const displayLabel = formatDerivedDisplayLabel(rawLabel, kind);
	const identifierSuffix = slugify(`${sourceNode.id}-${sectionTitle}-${rawLabel}-${relationship}`);
	const isStub = true;
	const isInactive = relationship === 'previous-employment' || /inactive|terminated|previous/i.test(rawValue);
	const badges: EntityBadge[] = [
		{ label: isStub ? 'Stub (detail-derived)' : 'Linked entity', tone: 'info' },
		{ label: isInactive ? 'Inactive / Previous' : 'Relationship discovered', tone: isInactive ? 'warning' : 'neutral' },
	];

	return {
		id: `${kind}-${identifierSuffix}`,
		label: displayLabel,
		kind,
		degreeHint: 0,
		size: kind === 'firm' ? 8.4 : 4.8,
		isHub: kind === 'firm',
		title: displayLabel,
		identifierLine: isStub ? 'Derived from relationship detail' : 'Linked entity',
		badges,
		marker: kind === 'firm' ? 'B' : 'I',
		summary: rawValue ? `${sectionTitle}: ${rawValue}` : `${sectionTitle} relationship derived from ${sourceNode.title}.`,
		searchText: `${displayLabel} ${rawValue} ${sectionTitle}`.toLowerCase(),
		externalLinks: [],
		detailSections: [
			{
				title: 'Derived Relationship',
				items: [
					{ label: 'Source node', value: sourceNode.title },
					{ label: 'Section', value: sectionTitle },
					{ label: 'Role / Context', value: rawValue || 'Not specified' },
				],
			},
		],
	};
}

function buildRelationshipLink(sourceNode: GraphNode, relatedNode: GraphNode, relationship: RelationshipKind): GraphLink {
	if (sourceNode.kind === 'individual') {
		return {
			source: sourceNode.id,
			target: relatedNode.id,
			weight: relationship === 'control' ? 1.7 : 2,
			relationship,
		};
	}

	if (relationship === 'control') {
		return {
			source: relatedNode.id,
			target: sourceNode.id,
			weight: 1.7,
			relationship,
		};
	}

	return {
		source: relatedNode.id,
		target: sourceNode.id,
		weight: 2,
		relationship,
	};
}

function hasLinkWithIdentity(links: GraphLink[], candidate: GraphLink): boolean {
	const candidateIdentity = getLinkIdentityKey(candidate);
	return links.some((link) => getLinkIdentityKey(link) === candidateIdentity);
}

function looksLikeFirmEntity(rawLabel: string, rawValue: string): boolean {
	const combined = `${rawLabel} ${rawValue}`.toLowerCase();
	return /(llc|llp|ltd|inc\.?|corp\.?|co\.?|company|securities|capital|advisors|advisor|financial|investments|partners|holdings|group|bank)/.test(combined);
}

function formatDerivedDisplayLabel(rawLabel: string, kind: GraphNodeKind): string {
	const trimmedLabel = rawLabel.trim();
	if (kind === 'individual') {
		const reordered = reorderCommaSeparatedName(trimmedLabel);
		return titleCasePreservingAcronyms(reordered);
	}

	return trimmedLabel === trimmedLabel.toUpperCase() ? trimmedLabel : titleCasePreservingAcronyms(trimmedLabel);
}

function reorderCommaSeparatedName(rawLabel: string): string {
	if (!rawLabel.includes(',')) {
		return rawLabel;
	}

	const [lastName, ...rest] = rawLabel
		.split(',')
		.map((part) => part.trim())
		.filter(Boolean);
	if (rest.length === 0) {
		return rawLabel;
	}

	return `${rest.join(' ')} ${lastName}`.trim();
}

function normalizeComparableLabel(value: string): string {
	return value
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, ' ')
		.trim();
}

function titleCasePreservingAcronyms(value: string): string {
	return value
		.split(/\s+/)
		.filter(Boolean)
		.map((part) => {
			if (/^[A-Z0-9&.-]{2,}$/.test(part)) {
				return part;
			}
			return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
		})
		.join(' ');
}

function slugify(value: string): string {
	return value
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');
}

function createFirmNode(seed: FirmSeed): GraphNode {
	const sourceFlag = inferIdSourceFlagFromDetails(seed.details);
	const badges = sourceFlag ? [...seed.badges, { label: sourceFlag, tone: 'info' as const }] : seed.badges;
	const detailSections = sourceFlag ? injectIdSourceFlagIntoDetails(seed.details, sourceFlag) : seed.details;
	return {
		id: seed.id,
		label: seed.name,
		kind: 'firm',
		degreeHint: 0,
		size: 10,
		isHub: true,
		title: seed.name,
		identifierLine: sourceFlag ? `CRD#: ${seed.crd} / SEC#: ${seed.sec} · ${sourceFlag}` : `CRD#: ${seed.crd} / SEC#: ${seed.sec}`,
		sourceFlag,
		badges,
		marker: 'B',
		summary: seed.summary,
		subtitle: seed.aliases?.join(', '),
		searchText: `${seed.name} ${seed.aliases?.join(' ') ?? ''} ${seed.crd} ${seed.sec}`.toLowerCase(),
		externalLinks: seed.externalLinks ?? [
			{ label: 'FINRA Summary', href: `https://brokercheck.finra.org/firm/summary/${seed.crd}` },
			{ label: 'FINRA Detailed Report (PDF)', href: `https://files.brokercheck.finra.org/firm/firm_${seed.crd}.pdf` },
		],
		detailSections,
	};
}

function createPersonNode(seed: PersonSeed): GraphNode {
	const sourceFlag = inferIdSourceFlagFromDetails(seed.details);
	const badges = sourceFlag ? [...seed.badges, { label: sourceFlag, tone: 'info' as const }] : seed.badges;
	const detailSections = sourceFlag ? injectIdSourceFlagIntoDetails(seed.details, sourceFlag) : seed.details;
	return {
		id: seed.id,
		label: seed.name,
		kind: 'individual',
		degreeHint: 0,
		size: 5,
		isHub: false,
		title: seed.name,
		identifierLine: sourceFlag ? `CRD#: ${seed.crd} · ${sourceFlag}` : `CRD#: ${seed.crd}`,
		sourceFlag,
		badges,
		marker: 'I',
		summary: seed.summary,
		searchText: `${seed.name} ${seed.crd}`.toLowerCase(),
		externalLinks: seed.externalLinks ?? [{ label: 'BrokerCheck Profile', href: `https://brokercheck.finra.org/individual/summary/${seed.crd}` }],
		detailSections,
	};
}

function createGeneratedFirms(count: number): GraphNode[] {
	const names = [
		'Arcstone Securities LLC',
		'Pacific Oak Capital Markets, LLC',
		'OnPeak Capital LLC',
		'Augment Capital, LLC',
		'Fortune Securities, Inc.',
		'Analyst Hub Securities, LLC',
		'Portum Capital LLC',
		'Capitala Securities, LLC',
		'Wildridge Securities',
		'GovDesk, LLC',
	];
	return Array.from({ length: count }, (_, index) => {
		const crd = `${60000 + index}`;
		const sec = `8-${41000 + index}`;
		return createFirmNode({
			id: `firm-${crd}`,
			crd,
			sec,
			name: `${names[index % names.length]} ${index >= 10 ? index + 1 : ''}`.trim(),
			summary: CITY_SUMMARIES[index % CITY_SUMMARIES.length],
			badges: [
				{ label: index % 3 === 0 ? 'Active' : 'Inactive', tone: index % 3 === 0 ? 'success' : 'warning' },
				{ label: `Disclosures ${index % 5}`, tone: index % 5 > 2 ? 'danger' : 'neutral' },
			],
			details: [
				{
					title: 'Registration',
					items: [
						{ label: 'ID source check', value: index % 2 === 0 ? 'FINRA=true · SEC=true (both SEC+FINRA)' : 'FINRA=true · SEC=false' },
						{ label: 'Registration status', value: index % 3 === 0 ? 'Active' : 'Inactive' },
						{ label: 'Regulator', value: 'SEC' },
					],
				},
				{
					title: 'General Information',
					items: [
						{ label: 'Company type', value: 'Corporation' },
						{ label: 'Fiscal year end', value: ['December', 'June', 'September'][index % 3] },
						{ label: 'District', value: ['Los Angeles', 'New York', 'Chicago'][index % 3] },
					],
				},
			],
		});
	});
}

function inferIdSourceFlagFromDetails(details: EntityDetailSection[]): IdSourceFlag | undefined {
	for (const section of details) {
		for (const item of section.items ?? []) {
			if (item.label !== 'ID source check') {
				continue;
			}

			const normalizedValue = item.value.toLowerCase();
			const hasFinraSource = normalizedValue.includes('finra=true');
			const hasSecSource = normalizedValue.includes('sec=true');
			return getIdSourceFlag(hasFinraSource, hasSecSource);
		}
	}

	return undefined;
}

function injectIdSourceFlagIntoDetails(details: EntityDetailSection[], sourceFlag: IdSourceFlag): EntityDetailSection[] {
	return details.map((section) => {
		if (!section.items?.some((item) => item.label === 'ID source check')) {
			return section;
		}

		if (section.items.some((item) => item.label === 'ID source flag')) {
			return section;
		}

		const nextItems: EntityDetailItem[] = [];
		for (const item of section.items) {
			nextItems.push(item);
			if (item.label === 'CRD') {
				nextItems.push({ label: 'ID source flag', value: sourceFlag });
			}
		}

		return {
			...section,
			items: nextItems,
		};
	});
}

function createGeneratedPeople(count: number): GraphNode[] {
	return Array.from({ length: count }, (_, index) => {
		const crd = `${8200000 + index}`;
		const name = `${FIRST_NAMES[index % FIRST_NAMES.length]} ${LAST_NAMES[index % LAST_NAMES.length]}`;
		return createPersonNode({
			id: `person-${crd}`,
			crd,
			name,
			summary: ['Registered Representative', 'Operations Principal', 'Investment Banking Representative'][index % 3],
			badges: [{ label: index % 4 === 0 ? 'Disclosures 1' : 'Disclosures 0', tone: index % 4 === 0 ? 'warning' : 'neutral' }],
			details: [
				{
					title: 'Profile',
					items: [
						{ label: 'CRD', value: crd },
						{ label: 'ID source check', value: index % 2 === 0 ? 'FINRA=true · SEC=false' : 'FINRA=false · SEC=false (none)' },
					],
				},
				{
					title: 'Previous Employment',
					paragraphs: [
						index % 5 === 0 ?
							`${name} previously associated with a regional broker-dealer and private placement practice.`
						:	'No previous employment records found for this profile.',
					],
				},
			],
		});
	});
}

function getSeedFirms(): FirmSeed[] {
	return [
		{
			id: 'firm-15621',
			crd: '15621',
			sec: '8-32454',
			name: 'NEXA SECURITIES',
			aliases: ['CAPITAL GAINS, INC.', 'QUARTERMOVE SECURITIES, INC.', 'INTEGRATED GLOBAL SECURITIES, INC.'],
			summary: 'Brokerage Firm Regulated by FINRA (Los Angeles)',
			badges: [
				{ label: 'Terminated 03/20/2006', tone: 'warning' },
				{ label: 'Inactive', tone: 'neutral' },
				{ label: 'Disclosures 3', tone: 'danger' },
			],
			details: [
				{
					title: 'Registration',
					items: [
						{ label: 'ID source check', value: 'FINRA=true · SEC=true (both SEC+FINRA)' },
						{ label: 'SEC registration status', value: 'Terminated (03/20/2006)' },
						{ label: 'FINRA district', value: 'Los Angeles' },
						{ label: 'Company type', value: 'Corporation' },
						{ label: 'Regulator', value: 'SEC' },
					],
				},
				{
					title: 'General Information',
					items: [
						{ label: 'Established', value: 'Texas since 09/05/1984' },
						{ label: 'Fiscal year end', value: 'December' },
					],
				},
				{
					title: 'Form BD — Direct Owners & Executive Officers',
					items: [
						{ label: 'WORLD SAFIRA, CO. LTD', value: 'DIRECT OWNER' },
						{ label: 'LIU, SUNE YUE', value: 'PRESIDENT, CCO' },
						{ label: 'THORNTON, STEVEN LEE', value: 'FINOP' },
					],
				},
			],
		},
		{
			id: 'firm-13092',
			crd: '13092',
			sec: '8-19012',
			name: 'MML INVESTORS SERVICES, LLC',
			summary: 'Brokerage Firm Regulated by FINRA (Springfield)',
			badges: [
				{ label: 'Active', tone: 'success' },
				{ label: 'Disclosures 0', tone: 'neutral' },
			],
			details: [
				{
					title: 'Registration',
					items: [
						{ label: 'Regulator', value: 'FINRA' },
						{ label: 'District', value: 'New York' },
					],
				},
			],
		},
		{
			id: 'firm-10205',
			crd: '10205',
			sec: '8-17177',
			name: 'WELLS FARGO SECURITIES, LLC',
			summary: 'Brokerage Firm Regulated by FINRA (Charlotte)',
			badges: [
				{ label: 'Active', tone: 'success' },
				{ label: 'Disclosures 1', tone: 'warning' },
			],
			details: [
				{
					title: 'Registration',
					items: [
						{ label: 'Regulator', value: 'FINRA / SEC' },
						{ label: 'District', value: 'New York' },
					],
				},
			],
		},
		{
			id: 'firm-42867',
			crd: '42867',
			sec: '8-49515',
			name: 'CAMBRIDGE INVESTMENT RESEARCH ADVISORS, INC.',
			summary: 'Brokerage Firm Regulated by FINRA (Fairfield)',
			badges: [
				{ label: 'Active', tone: 'success' },
				{ label: 'Disclosures 0', tone: 'neutral' },
			],
			details: [
				{
					title: 'Registration',
					items: [
						{ label: 'Regulator', value: 'SEC' },
						{ label: 'District', value: 'Chicago' },
					],
				},
			],
		},
		{
			id: 'firm-10908',
			crd: '10908',
			sec: '8-22239',
			name: 'P.J. ROBB VARIABLE, LLC',
			summary: 'Brokerage Firm Regulated by FINRA (New York)',
			badges: [
				{ label: 'Active', tone: 'success' },
				{ label: 'Disclosures 2', tone: 'warning' },
			],
			details: [
				{
					title: 'Registration',
					items: [
						{ label: 'Regulator', value: 'FINRA' },
						{ label: 'District', value: 'New York' },
					],
				},
			],
		},
		{
			id: 'firm-13249',
			crd: '13249',
			sec: '8-31514',
			name: 'CAMBRIDGE INVESTMENT RESEARCH, INC.',
			summary: 'Brokerage Firm Regulated by FINRA (Fairfield)',
			badges: [
				{ label: 'Active', tone: 'success' },
				{ label: 'Disclosures 0', tone: 'neutral' },
			],
			details: [
				{
					title: 'Registration',
					items: [
						{ label: 'Regulator', value: 'FINRA' },
						{ label: 'District', value: 'Chicago' },
					],
				},
			],
		},
		{
			id: 'firm-15473',
			crd: '15473',
			sec: '8-27950',
			name: 'AMERIPRISE FINANCIAL SERVICES, LLC',
			summary: 'Brokerage Firm Regulated by FINRA (Minneapolis)',
			badges: [
				{ label: 'Active', tone: 'success' },
				{ label: 'Disclosures 2', tone: 'warning' },
			],
			details: [
				{
					title: 'Registration',
					items: [
						{ label: 'Regulator', value: 'FINRA / SEC' },
						{ label: 'District', value: 'Chicago' },
					],
				},
			],
		},
		{
			id: 'firm-24510',
			crd: '24510',
			sec: '8-15755',
			name: 'RAYMOND JAMES & ASSOCIATES, INC.',
			summary: 'Brokerage Firm Regulated by FINRA (St. Petersburg)',
			badges: [
				{ label: 'Active', tone: 'success' },
				{ label: 'Disclosures 1', tone: 'warning' },
			],
			details: [
				{
					title: 'Registration',
					items: [
						{ label: 'Regulator', value: 'FINRA / SEC' },
						{ label: 'District', value: 'Florida' },
					],
				},
			],
		},
		{
			id: 'firm-29114',
			crd: '29114',
			sec: '8-44444',
			name: 'SYMETRA SECURITIES, INC.',
			summary: 'Brokerage Firm Regulated by FINRA (Bellevue)',
			badges: [
				{ label: 'Active', tone: 'success' },
				{ label: 'Disclosures 0', tone: 'neutral' },
			],
			details: [
				{
					title: 'Registration',
					items: [
						{ label: 'Regulator', value: 'FINRA' },
						{ label: 'District', value: 'Seattle' },
					],
				},
			],
		},
		{
			id: 'firm-8842',
			crd: '8842',
			sec: '8-7221',
			name: 'MERRILL LYNCH, PIERCE, FENNER & SMITH INCORPORATED',
			summary: 'Brokerage Firm Regulated by FINRA (New York)',
			badges: [
				{ label: 'Active', tone: 'success' },
				{ label: 'Disclosures 3', tone: 'danger' },
			],
			details: [
				{
					title: 'Registration',
					items: [
						{ label: 'Regulator', value: 'FINRA / SEC' },
						{ label: 'District', value: 'New York' },
					],
				},
			],
		},
		{
			id: 'firm-16735',
			crd: '16735',
			sec: '8-15259',
			name: 'UBS FINANCIAL SERVICES INC.',
			summary: 'Brokerage Firm Regulated by FINRA (Weehawken)',
			badges: [
				{ label: 'Active', tone: 'success' },
				{ label: 'Disclosures 2', tone: 'warning' },
			],
			details: [
				{
					title: 'Registration',
					items: [
						{ label: 'Regulator', value: 'FINRA / SEC' },
						{ label: 'District', value: 'New York' },
					],
				},
			],
		},
		{
			id: 'firm-42180',
			crd: '42180',
			sec: '8-49349',
			name: 'LESKO SECURITIES INC.',
			summary: 'Brokerage Firm Regulated by FINRA (Beverly Hills)',
			badges: [
				{ label: 'Active', tone: 'success' },
				{ label: 'Disclosures 0', tone: 'neutral' },
			],
			details: [
				{
					title: 'Registration',
					items: [
						{ label: 'Regulator', value: 'FINRA' },
						{ label: 'District', value: 'Los Angeles' },
					],
				},
			],
		},
		{
			id: 'firm-7748',
			crd: '7748',
			sec: '8-7188',
			name: 'TBN SECURITIES, INC.',
			summary: 'Brokerage Firm Regulated by FINRA (Los Angeles)',
			badges: [
				{ label: 'Active', tone: 'success' },
				{ label: 'Disclosures 1', tone: 'warning' },
			],
			details: [
				{
					title: 'Registration',
					items: [
						{ label: 'Regulator', value: 'FINRA' },
						{ label: 'District', value: 'Los Angeles' },
					],
				},
			],
		},
	];
}

function getSeedPeople(): PersonSeed[] {
	return [
		{
			id: 'person-3004487',
			crd: '3004487',
			name: 'Sune Yue Liu',
			summary: 'Form BD stub',
			badges: [{ label: 'Disclosures 0', tone: 'neutral' }],
			details: [
				{
					title: 'Profile',
					items: [
						{ label: 'CRD', value: '3004487' },
						{ label: 'ID source check', value: 'FINRA=false · SEC=false (none)' },
					],
				},
				{ title: 'Previous Employment', paragraphs: ['No previous employment records found for this profile.'] },
				{ title: 'Control Positions', items: [{ label: 'NEXA SECURITIES SEC#32454', value: 'Terminated' }] },
			],
		},
		{
			id: 'person-4496384',
			crd: '4496384',
			name: 'Steven Lee Thornton',
			summary: 'FINOP and operations principal',
			badges: [{ label: 'Disclosures 0', tone: 'neutral' }],
			details: [
				{
					title: 'Profile',
					items: [
						{ label: 'CRD', value: '4496384' },
						{ label: 'ID source check', value: 'FINRA=true · SEC=false' },
					],
				},
				{ title: 'Previous Employment', paragraphs: ['Previously associated with multiple independent broker-dealers and compliance-focused firms.'] },
				{
					title: 'Control Positions',
					items: [
						{ label: 'NEXA SECURITIES', value: 'FINOP' },
						{ label: 'MML INVESTORS SERVICES, LLC', value: 'Operations Principal' },
					],
				},
			],
		},
		{
			id: 'person-2811544',
			crd: '2811544',
			name: 'James Michael Thornton',
			summary: 'Registered Representative',
			badges: [{ label: 'Disclosures 0', tone: 'neutral' }],
			details: [
				{
					title: 'Profile',
					items: [
						{ label: 'CRD', value: '2811544' },
						{ label: 'ID source check', value: 'FINRA=true · SEC=false' },
					],
				},
			],
		},
		{
			id: 'person-6759010',
			crd: '6759010',
			name: 'Roy Charles Thornton',
			summary: 'Registered Representative',
			badges: [{ label: 'Disclosures 0', tone: 'neutral' }],
			details: [
				{
					title: 'Profile',
					items: [
						{ label: 'CRD', value: '6759010' },
						{ label: 'ID source check', value: 'FINRA=true · SEC=false' },
					],
				},
			],
		},
		{
			id: 'person-7547544',
			crd: '7547544',
			name: 'Alexandra Thornton',
			summary: 'Financial advisor associate',
			badges: [{ label: 'Disclosures 0', tone: 'neutral' }],
			details: [
				{
					title: 'Profile',
					items: [
						{ label: 'CRD', value: '7547544' },
						{ label: 'ID source check', value: 'FINRA=true · SEC=false' },
					],
				},
			],
		},
		{
			id: 'person-1853032',
			crd: '1853032',
			name: 'Thomas Scott Thornton',
			summary: 'Investment banking representative',
			badges: [{ label: 'Disclosures 1', tone: 'warning' }],
			details: [
				{
					title: 'Profile',
					items: [
						{ label: 'CRD', value: '1853032' },
						{ label: 'ID source check', value: 'FINRA=true · SEC=true' },
					],
				},
			],
		},
		{
			id: 'person-2186376',
			crd: '2186376',
			name: 'G Eric Thornton',
			summary: 'Supervisory principal',
			badges: [{ label: 'Disclosures 0', tone: 'neutral' }],
			details: [
				{
					title: 'Profile',
					items: [
						{ label: 'CRD', value: '2186376' },
						{ label: 'ID source check', value: 'FINRA=true · SEC=false' },
					],
				},
			],
		},
		{
			id: 'person-4297530',
			crd: '4297530',
			name: 'Peterson C Thornton',
			summary: 'Private placement representative',
			badges: [{ label: 'Disclosures 0', tone: 'neutral' }],
			details: [
				{
					title: 'Profile',
					items: [
						{ label: 'CRD', value: '4297530' },
						{ label: 'ID source check', value: 'FINRA=true · SEC=false' },
					],
				},
			],
		},
		{
			id: 'person-4851680',
			crd: '4851680',
			name: 'Kenneth Alec Thornton',
			summary: 'Investment products representative',
			badges: [{ label: 'Disclosures 0', tone: 'neutral' }],
			details: [
				{
					title: 'Profile',
					items: [
						{ label: 'CRD', value: '4851680' },
						{ label: 'ID source check', value: 'FINRA=true · SEC=false' },
					],
				},
			],
		},
		{
			id: 'person-5164583',
			crd: '5164583',
			name: 'Joseph Harrison Thornton',
			summary: 'Series 7 representative',
			badges: [{ label: 'Disclosures 0', tone: 'neutral' }],
			details: [
				{
					title: 'Profile',
					items: [
						{ label: 'CRD', value: '5164583' },
						{ label: 'ID source check', value: 'FINRA=true · SEC=false' },
					],
				},
			],
		},
		{
			id: 'person-5368109',
			crd: '5368109',
			name: 'Charles John Thornton',
			summary: 'Financial advisor',
			badges: [{ label: 'Disclosures 0', tone: 'neutral' }],
			details: [
				{
					title: 'Profile',
					items: [
						{ label: 'CRD', value: '5368109' },
						{ label: 'ID source check', value: 'FINRA=true · SEC=false' },
					],
				},
			],
		},
		{
			id: 'person-5573647',
			crd: '5573647',
			name: 'Adam Michael Thornton',
			summary: 'Wealth management representative',
			badges: [{ label: 'Disclosures 1', tone: 'warning' }],
			details: [
				{
					title: 'Profile',
					items: [
						{ label: 'CRD', value: '5573647' },
						{ label: 'ID source check', value: 'FINRA=true · SEC=false' },
					],
				},
			],
		},
		{
			id: 'person-7736566',
			crd: '7736566',
			name: 'Rodney Clay Thornton',
			summary: 'Newly registered representative',
			badges: [{ label: 'Disclosures 0', tone: 'neutral' }],
			details: [
				{
					title: 'Profile',
					items: [
						{ label: 'CRD', value: '7736566' },
						{ label: 'ID source check', value: 'FINRA=true · SEC=false' },
					],
				},
			],
		},
		{
			id: 'person-1413678',
			crd: '1413678',
			name: 'Homer Lee Thornton',
			summary: 'Senior securities representative',
			badges: [{ label: 'Disclosures 0', tone: 'neutral' }],
			details: [
				{
					title: 'Profile',
					items: [
						{ label: 'CRD', value: '1413678' },
						{ label: 'ID source check', value: 'FINRA=true · SEC=false' },
					],
				},
			],
		},
	];
}

function createAdjacencyMap(links: GraphLink[]): Map<string, Set<string>> {
	const adjacency = new Map<string, Set<string>>();
	for (const link of links) {
		const source = getEndpointId(link.source);
		const target = getEndpointId(link.target);
		if (!adjacency.has(source)) adjacency.set(source, new Set());
		if (!adjacency.has(target)) adjacency.set(target, new Set());
		adjacency.get(source)?.add(target);
		adjacency.get(target)?.add(source);
	}
	return adjacency;
}

function createLinksByNodeId(links: GraphLink[]): Map<string, GraphLink[]> {
	const linksByNodeId = new Map<string, GraphLink[]>();
	for (const link of links) {
		const source = getEndpointId(link.source);
		const target = getEndpointId(link.target);
		linksByNodeId.set(source, [...(linksByNodeId.get(source) ?? []), link]);
		linksByNodeId.set(target, [...(linksByNodeId.get(target) ?? []), link]);
	}
	return linksByNodeId;
}

function addLink(
	links: GraphLink[],
	degreeCounts: Map<string, number>,
	linkKeys: Set<string>,
	sourceId: string,
	targetId: string,
	weight: number,
	relationship: RelationshipKind,
): void {
	if (sourceId === targetId) return;
	const key = sourceId < targetId ? `${sourceId}:${targetId}` : `${targetId}:${sourceId}`;
	if (linkKeys.has(key)) return;
	linkKeys.add(key);
	degreeCounts.set(sourceId, (degreeCounts.get(sourceId) ?? 0) + 1);
	degreeCounts.set(targetId, (degreeCounts.get(targetId) ?? 0) + 1);
	links.push({ source: sourceId, target: targetId, weight, relationship });
}

function connectEmployment(links: GraphLink[], linkKeys: Set<string>, degreeCounts: Map<string, number>, personId: string, firmIds: string[]): void {
	for (const firmId of firmIds) addLink(links, degreeCounts, linkKeys, personId, firmId, 2, 'employment');
}

function getNodeSize(degreeHint: number, isHub: boolean, kind: GraphNodeKind): number {
	const normalizedDegree = Math.max(0, degreeHint);
	const hasMultipleConnections = normalizedDegree > 1;

	if (isHub) {
		const baseSize = 16;
		const connectedSize = baseSize + Math.log2(normalizedDegree + 1) * 2.8 + (hasMultipleConnections ? 1.4 : 0);
		return Math.min(30, connectedSize);
	}

	if (kind === 'individual') {
		const baseSize = 9.6;
		const connectedSize = baseSize + Math.log2(normalizedDegree + 1) * 1.8 + (hasMultipleConnections ? 1.1 : 0);
		return Math.min(16.5, connectedSize);
	}

	return 11;
}

function scoreSearchMatch(haystack: string, needle: string): number {
	const index = haystack.indexOf(needle);
	return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}

export function getEndpointId(endpoint: string | GraphNode): string {
	return typeof endpoint === 'string' ? endpoint : endpoint.id;
}

function getOppositeEndpointId(link: GraphLink, nodeId: string): string | null {
	const sourceId = getEndpointId(link.source);
	const targetId = getEndpointId(link.target);
	if (sourceId === nodeId) {
		return targetId;
	}
	if (targetId === nodeId) {
		return sourceId;
	}
	return null;
}

export function getLinkKey(link: GraphLink): string {
	const source = getEndpointId(link.source);
	const target = getEndpointId(link.target);
	return source < target ? `${source}:${target}` : `${target}:${source}`;
}

export function getLinkIdentityKey(link: GraphLink): string {
	return `${getLinkKey(link)}:${link.relationship}`;
}
