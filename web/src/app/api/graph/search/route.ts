import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { GraphLink, GraphNode } from '@/lib/graph-data';

const cache: {
	graphData?: { nodes: GraphNode[]; links: GraphLink[]; adjacency: Map<string, Set<string>>; nodeById: Map<string, GraphNode> };
} = {};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const RAW_DATA_DIR = path.join(__dirname, '../../../../../../data/raw');
const STARTUP_SEED_PEOPLE_COUNT = 7;
const STARTUP_SEED_FIRM_COUNT = 4;

function getEndpointId(endpoint: string | GraphNode): string {
	return typeof endpoint === 'string' ? endpoint : endpoint.id;
}

function normalizeText(value: unknown): string {
	return String(value ?? '')
		.replace(/\s+/g, ' ')
		.trim()
		.toLowerCase();
}

function getNodeSize(degreeHint: number, isHub: boolean, kind: GraphNode['kind']): number {
	const connectionCount = Math.max(0, degreeHint);
	const degreeScale = Math.pow(connectionCount, 0.68) * 2.35;

	if (kind === 'firm') {
		return Math.min(54, (13 + degreeScale + (isHub ? 3 : 0)) * 1.5);
	}

	return Math.min(36, (7 + degreeScale + (isHub ? 1.5 : 0)) * 1.5);
}

function createFirmNodeFromRaw(content: any, fallbackId: string): GraphNode {
	const data = content.content ?? content;
	const crd = String(data.basicInformation?.crd ?? data.basicInformation?.firmId ?? fallbackId);
	const firmId = data.basicInformation?.firmId ?? fallbackId;
	const id = `firm-${crd}`;
	const name = data.basicInformation?.firmName ?? data.basicInformation?.name ?? `Firm ${firmId}`;
	const sec = String(data.basicInformation?.bdSECNumber ?? data.basicInformation?.sec ?? '');
	const active = String(data.basicInformation?.firmBCScope ?? data.basicInformation?.bcScope ?? '').toLowerCase() === 'active';
	const summary = data.basicInformation?.firmName ? `Firm profile for ${name}` : 'Firm profile loaded from raw data.';

	return {
		id,
		label: name,
		kind: 'firm',
		degreeHint: 0,
		size: 10,
		isHub: true,
		isActive: active,
		title: name,
		identifierLine: `CRD#: ${crd}${sec ? ` / SEC#: ${sec}` : ''}`,
		badges: [{ label: active ? 'Active' : 'Inactive', tone: active ? 'success' : 'neutral' }],
		marker: 'B',
		summary,
		subtitle: data.basicInformation?.firmBCScope ?? data.basicInformation?.bcScope,
		searchText: normalizeText(`${name} ${crd} ${sec} ${data.basicInformation?.firmBCScope ?? ''}`),
		externalLinks: [],
		detailSections: [
			{
				title: 'Registration',
				items: [
					{ label: 'CRD', value: crd },
					{ label: 'SEC number', value: sec },
				],
			},
		],
	};
}

function createPersonNodeFromRaw(content: any, fallbackId: string): GraphNode {
	const data = content.content ?? content;
	const basic = data.basicInformation ?? {};
	const crd = String(basic.crd ?? basic.individualId ?? fallbackId);
	const individualId = basic.individualId ?? fallbackId;
	const firstName = basic.firstName ?? '';
	const middleName = basic.middleName ?? '';
	const lastName = basic.lastName ?? '';
	const name = [firstName, middleName, lastName].filter(Boolean).join(' ').trim() || `Person ${individualId}`;
	const otherNames = Array.isArray(basic.otherNames) ? basic.otherNames.map(String) : [];
	const active = String(basic.bcScope ?? '').toLowerCase() === 'active';
	const summary = `Individual profile for ${name}`;

	return {
		id: `person-${crd}`,
		label: name,
		kind: 'individual',
		degreeHint: 0,
		size: 5,
		isHub: false,
		isActive: active,
		title: name,
		identifierLine: `CRD#: ${crd}${individualId ? ` · ID#: ${individualId}` : ''}`,
		badges: [{ label: active ? 'Active' : 'Inactive', tone: active ? 'success' : 'neutral' }],
		marker: 'I',
		summary,
		subtitle: basic.bcScope ? `${basic.bcScope} individual` : undefined,
		individualId: Number(individualId),
		firstName,
		middleName,
		lastName,
		otherNames,
		searchText: normalizeText(`${name} ${otherNames.join(' ')} ${crd} ${individualId}`),
		externalLinks: individualId ? [{ label: 'BrokerCheck Profile', href: `https://brokercheck.finra.org/individual/summary/${individualId}` }] : [],
		detailSections: [
			{
				title: 'Profile',
				items: [
					{ label: 'Individual ID', value: String(individualId) },
					{ label: 'CRD', value: crd },
					{ label: 'Status', value: basic.bcScope ?? 'Unknown' },
				],
			},
		],
	};
}

function buildRawGraph() {
	const nodesById = new Map<string, GraphNode>();
	const links: GraphLink[] = [];
	const fileNames = fs.readdirSync(RAW_DATA_DIR);

	for (const fileName of fileNames) {
		if (!fileName.endsWith('.json')) continue;
		const filePath = path.join(RAW_DATA_DIR, fileName);
		const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
		const [namespace, type, idPart] = fileName.replace(/\.json$/, '').split(':');
		if (type === 'firm') {
			const firmNode = createFirmNodeFromRaw(raw, idPart);
			nodesById.set(firmNode.id, firmNode);
			continue;
		}

		if (type === 'individual') {
			const personNode = createPersonNodeFromRaw(raw, idPart);
			nodesById.set(personNode.id, personNode);

			const content = raw.content ?? raw;
			const currentEmployments = Array.isArray(content.currentEmployments) ? content.currentEmployments : [];
			const previousEmployments = Array.isArray(content.previousEmployments) ? content.previousEmployments : [];

			for (const employment of currentEmployments) {
				const firmId = String(employment.firmId ?? '');
				if (!firmId) continue;

				const firmKey = `firm-${firmId}`;
				if (!nodesById.has(firmKey)) {
					const firmNode: GraphNode = {
						id: firmKey,
						label: String(employment.firmName ?? `Firm ${firmId}`),
						kind: 'firm',
						degreeHint: 0,
						size: 10,
						isHub: true,
						isActive: String(employment.firmBCScope ?? '').toLowerCase() === 'active',
						title: String(employment.firmName ?? `Firm ${firmId}`),
						identifierLine: `CRD#: ${employment.bdSECNumber ?? ''}`,
						badges: [{ label: employment.firmBCScope ?? 'Firm', tone: 'neutral' }],
						marker: 'B',
						summary: String(employment.firmName ?? `Firm ${firmId}`),
						searchText: normalizeText(`${employment.firmName ?? ''} ${employment.bdSECNumber ?? ''}`),
						externalLinks: [],
						detailSections: [],
					};
					nodesById.set(firmKey, firmNode);
				}

				links.push({
					source: personNode.id,
					target: firmKey,
					weight: 1,
					relationship: 'employment',
				});
			}

			for (const employment of previousEmployments) {
				const firmId = String(employment.firmId ?? '');
				if (!firmId) continue;

				const firmKey = `firm-${firmId}`;
				if (!nodesById.has(firmKey)) {
					const firmNode: GraphNode = {
						id: firmKey,
						label: String(employment.firmName ?? `Firm ${firmId}`),
						kind: 'firm',
						degreeHint: 0,
						size: 10,
						isHub: true,
						isActive: String(employment.firmBCScope ?? '').toLowerCase() === 'active',
						title: String(employment.firmName ?? `Firm ${firmId}`),
						identifierLine: `CRD#: ${employment.bdSECNumber ?? ''}`,
						badges: [{ label: employment.firmBCScope ?? 'Firm', tone: 'neutral' }],
						marker: 'B',
						summary: String(employment.firmName ?? `Firm ${firmId}`),
						searchText: normalizeText(`${employment.firmName ?? ''} ${employment.bdSECNumber ?? ''}`),
						externalLinks: [],
						detailSections: [],
					};
					nodesById.set(firmKey, firmNode);
				}

				links.push({
					source: personNode.id,
					target: firmKey,
					weight: 1,
					relationship: 'disclosure',
				});
			}
		}
	}

	const allNodes = Array.from(nodesById.values());
	const degreeCounts = new Map<string, number>();
	const adjacency = new Map<string, Set<string>>();
	for (const link of links) {
		const source = getEndpointId(link.source);
		const target = getEndpointId(link.target);
		degreeCounts.set(source, (degreeCounts.get(source) ?? 0) + 1);
		degreeCounts.set(target, (degreeCounts.get(target) ?? 0) + 1);
		if (!adjacency.has(source)) adjacency.set(source, new Set());
		if (!adjacency.has(target)) adjacency.set(target, new Set());
		adjacency.get(source)?.add(target);
		adjacency.get(target)?.add(source);
	}

	for (const node of allNodes) {
		node.degreeHint = degreeCounts.get(node.id) ?? 0;
		node.size = getNodeSize(node.degreeHint, node.isHub, node.kind);
	}

	return { nodes: allNodes, links, adjacency, nodeById: nodesById };
}

function compareNodesBySize(left: GraphNode, right: GraphNode): number {
	if (right.size !== left.size) {
		return right.size - left.size;
	}

	if (right.degreeHint !== left.degreeHint) {
		return right.degreeHint - left.degreeHint;
	}

	return left.title.localeCompare(right.title);
}

function getDirectNeighborSelection(adjacency: Map<string, Set<string>>, nodeId: string): Set<string> {
	const visibleNodeIds = new Set<string>([nodeId]);
	for (const neighborId of adjacency.get(nodeId) ?? new Set<string>()) {
		visibleNodeIds.add(neighborId);
	}
	return visibleNodeIds;
}

function buildStartupSelection(nodes: GraphNode[], adjacency: Map<string, Set<string>>): { seedNodes: GraphNode[]; visibleNodeIds: Set<string> } {
	const largestPeople = nodes
		.filter((node) => node.kind === 'individual')
		.sort(compareNodesBySize)
		.slice(0, STARTUP_SEED_PEOPLE_COUNT);
	const largestFirms = nodes
		.filter((node) => node.kind === 'firm')
		.sort(compareNodesBySize)
		.slice(0, STARTUP_SEED_FIRM_COUNT);
	const seedNodes = [...largestPeople, ...largestFirms];
	const visibleNodeIds = new Set<string>();

	for (const seedNode of seedNodes) {
		for (const visibleNodeId of getDirectNeighborSelection(adjacency, seedNode.id)) {
			visibleNodeIds.add(visibleNodeId);
		}
	}

	return { seedNodes, visibleNodeIds };
}

function scoreSearchMatch(text: string, query: string): number {
	const distance = levenshteinDistance(text, query);
	return distance + (text.includes(query) ? 0 : 10);
}

function levenshteinDistance(source: string, target: string): number {
	const m = source.length;
	const n = target.length;
	const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
	for (let i = 0; i <= m; i += 1) dp[i][0] = i;
	for (let j = 0; j <= n; j += 1) dp[0][j] = j;
	for (let i = 1; i <= m; i += 1) {
		for (let j = 1; j <= n; j += 1) {
			dp[i][j] = source[i - 1] === target[j - 1] ? dp[i - 1][j - 1] : Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + 1);
		}
	}
	return dp[m][n];
}

function isSearchMatch(node: GraphNode, normalizedQuery: string): boolean {
	if (node.searchText.includes(normalizedQuery)) {
		return true;
	}

	if (normalizedQuery.length < 2) {
		return false;
	}

	const queryTokens = normalizedQuery.split(/\s+/).filter(Boolean);
	const searchTokens = node.searchText.split(/[^a-z0-9]+/).filter(Boolean);
	const threshold = Math.max(1, Math.floor(normalizedQuery.length * 0.25));

	return queryTokens.every((queryToken) => searchTokens.some((searchToken) => searchToken.includes(queryToken) || levenshteinDistance(searchToken, queryToken) <= threshold));
}

function expandSelection(adjacency: Map<string, Set<string>>, nodeById: Map<string, GraphNode>, nodeId: string): Set<string> {
	const visibleNodeIds = new Set<string>([nodeId]);
	const selectedNode = nodeById.get(nodeId);
	if (!selectedNode) return visibleNodeIds;

	const directNeighbors = adjacency.get(nodeId) ?? new Set<string>();
	for (const neighborId of directNeighbors) visibleNodeIds.add(neighborId);

	if (selectedNode.kind === 'individual') {
		for (const neighborId of directNeighbors) {
			const neighborNode = nodeById.get(neighborId);
			if (neighborNode?.kind !== 'firm') continue;
			for (const secondDegreeId of adjacency.get(neighborId) ?? []) visibleNodeIds.add(secondDegreeId);
		}
	}

	return visibleNodeIds;
}

function getGraphData() {
	if (!cache.graphData) {
		cache.graphData = buildRawGraph();
	}
	return cache.graphData;
}

export async function GET(request: Request) {
	const url = new URL(request.url);
	const query = normalizeText(url.searchParams.get('q') ?? '');
	const loadAll = url.searchParams.get('all') === 'true';
	const startupMode = url.searchParams.get('startup');
	const countParam = url.searchParams.get('count');
	const peopleParam = url.searchParams.get('people');
	const firmsParam = url.searchParams.get('firms');
	const requestedCount = Number(countParam);
	const requestedPeople = Number(peopleParam);
	const requestedFirms = Number(firmsParam);
	const hasCountRequest = Number.isFinite(requestedCount) && requestedCount > 0;
	const hasPeopleAndFirmRequest = Number.isFinite(requestedPeople) && requestedPeople > 0 && Number.isFinite(requestedFirms) && requestedFirms > 0;
	const { nodes, links, adjacency, nodeById } = getGraphData();

	if (loadAll) {
		const visibleNodeIds = new Set(nodes.map((node) => node.id));
		const visibleLinks = links.filter((link) => visibleNodeIds.has(getEndpointId(link.source)) && visibleNodeIds.has(getEndpointId(link.target)));
		return NextResponse.json({
			query: 'ALL',
			visibleNodeIds: Array.from(visibleNodeIds),
			visibleNodes: nodes,
			visibleLinks,
			matchedNodeIds: [],
			primaryMatchId: null,
			message: `Loaded all ${nodes.length} nodes from the raw dataset.`,
		});
	}

	if (startupMode === 'leaders' && !query) {
		const { seedNodes, visibleNodeIds } = buildStartupSelection(nodes, adjacency);
		const visibleNodes = nodes.filter((node) => visibleNodeIds.has(node.id));
		const visibleLinks = links.filter((link) => visibleNodeIds.has(getEndpointId(link.source)) && visibleNodeIds.has(getEndpointId(link.target)));
		return NextResponse.json({
			query: '',
			visibleNodeIds: Array.from(visibleNodeIds),
			visibleNodes,
			visibleLinks,
			matchedNodeIds: seedNodes.map((node) => node.id),
			primaryMatchId: seedNodes[0]?.id ?? null,
			message: `Loaded startup graph from ${STARTUP_SEED_PEOPLE_COUNT} largest people and ${STARTUP_SEED_FIRM_COUNT} largest firms, with their direct child nodes shown.`,
		});
	}

	if ((hasPeopleAndFirmRequest || hasCountRequest) && !query) {
		const people = nodes.filter((node) => node.kind === 'individual');
		const firms = nodes.filter((node) => node.kind === 'firm');
		const personCount = hasPeopleAndFirmRequest ? Math.min(requestedPeople, people.length) : Math.min(Math.floor(Math.min(requestedCount, nodes.length) * 0.75), people.length);
		const firmCount = hasPeopleAndFirmRequest ? Math.min(requestedFirms, firms.length) : Math.min(Math.min(requestedCount, nodes.length) - personCount, firms.length);
		const selectedPeople = people.slice(0, personCount);

		const connectedFirmIds = new Set<string>();
		for (const person of selectedPeople) {
			for (const neighborId of adjacency.get(person.id) ?? new Set()) {
				const neighborNode = nodeById.get(neighborId);
				if (neighborNode?.kind === 'firm') {
					connectedFirmIds.add(neighborId);
				}
			}
		}

		const selectedFirmNodes = firms.filter((firm) => connectedFirmIds.has(firm.id)).slice(0, firmCount);
		const extraFirmNodes = firms.filter((firm) => !connectedFirmIds.has(firm.id)).slice(0, Math.max(0, firmCount - selectedFirmNodes.length));
		const visibleNodes = [...selectedPeople, ...selectedFirmNodes, ...extraFirmNodes];
		const visibleNodeIds = new Set(visibleNodes.map((node) => node.id));
		const visibleLinks = links.filter((link) => visibleNodeIds.has(getEndpointId(link.source)) && visibleNodeIds.has(getEndpointId(link.target)));
		return NextResponse.json({
			query: '',
			visibleNodeIds: Array.from(visibleNodeIds),
			visibleNodes,
			visibleLinks,
			matchedNodeIds: [],
			primaryMatchId: null,
			message: `Loaded ${visibleNodeIds.size} nodes from the raw dataset. (${selectedPeople.length} people, ${Math.min(firmCount, selectedFirmNodes.length + extraFirmNodes.length)} firms)`,
		});
	}

	if (!query) {
		return NextResponse.json({
			query: '',
			visibleNodeIds: [],
			visibleNodes: [],
			visibleLinks: [],
			matchedNodeIds: [],
			primaryMatchId: null,
			message: 'Enter a name, firm, or CRD/SEC# to search the full dataset.',
		});
	}
	const matches = nodes.filter((node) => isSearchMatch(node, query)).sort((left, right) => scoreSearchMatch(left.searchText, query) - scoreSearchMatch(right.searchText, query));

	const matchedNodeIds = matches.map((node) => node.id);
	const primaryMatchId = matches[0]?.id ?? null;
	const visibleNodeIds = new Set<string>();

	for (const match of matches.slice(0, 20)) {
		for (const neighborId of getDirectNeighborSelection(adjacency, match.id)) {
			visibleNodeIds.add(neighborId);
		}
	}

	const visibleNodes = Array.from(visibleNodeIds)
		.map((id) => nodeById.get(id))
		.filter(Boolean) as GraphNode[];
	const visibleLinks = links.filter((link) => visibleNodeIds.has(getEndpointId(link.source)) && visibleNodeIds.has(getEndpointId(link.target)));

	return NextResponse.json({
		query,
		visibleNodeIds: Array.from(visibleNodeIds),
		visibleNodes,
		visibleLinks,
		matchedNodeIds,
		primaryMatchId,
		message: matches.length === 0 ? `No matches found for "${query}".` : `Fetched ${visibleNodeIds.size} nodes for "${query}" with direct connections only.`,
	});
}
