import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { GraphLink, GraphNode } from '@/lib/graph-data';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const RAW_DATA_DIR = path.join(__dirname, '../../../../../../data/raw');
const DEFAULT_NAMESPACE = 'finra';

function getEndpointId(endpoint: string | GraphNode): string {
	return typeof endpoint === 'string' ? endpoint : endpoint.id;
}

function normalizeText(value: unknown): string {
	return String(value ?? '')
		.replace(/\s+/g, ' ')
		.trim()
		.toLowerCase();
}

function buildNodeId(namespace: string, type: 'individual' | 'firm', crd: string): string {
	return `${namespace}:${type}:${String(crd).trim()}`;
}

function getNodeNamespace(fallbackId?: string): string {
	if (!fallbackId) return DEFAULT_NAMESPACE;
	const [namespace] = fallbackId.split(':');
	return namespace?.trim() || DEFAULT_NAMESPACE;
}

function getCanonicalNodeId(namespace: string, type: 'individual' | 'firm', fallbackId: string): string {
	return fallbackId.includes(':') ? fallbackId : buildNodeId(namespace, type, fallbackId);
}

function getNodeSize(degreeHint: number, isHub: boolean, kind: GraphNode['kind']): number {
	const connectionCount = Math.max(0, degreeHint);
	
	if (kind === 'firm') {
		// Firm sizing (increased by an additional 40%)
		const degreeScale = Math.pow(connectionCount, 0.35) * 2.35;
		return 9.45 + degreeScale + (isHub ? 2.35 : 0);
	}

	// People: larger base size and more aggressive scaling
	const degreeScale = Math.pow(connectionCount, 0.7) * 2.5;
	return 15 + degreeScale;
}

function createFirmNodeFromRaw(content: any, fallbackId: string, namespace = getNodeNamespace(fallbackId)): GraphNode {
	const data = content.content ?? content;
	const crd = String(data.basicInformation?.crd ?? data.basicInformation?.firmId ?? fallbackId);
	const firmId = data.basicInformation?.firmId ?? fallbackId;
	const id = getCanonicalNodeId(namespace, 'firm', fallbackId || crd);
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
		searchText: normalizeText(`${id} ${name} ${crd} ${sec} ${data.basicInformation?.firmBCScope ?? ''}`),
		externalLinks: [],
		detailSections: [],
	} as GraphNode;
}

function createPersonNodeFromRaw(content: any, fallbackId: string, namespace = getNodeNamespace(fallbackId)): GraphNode {
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
	const id = getCanonicalNodeId(namespace, 'individual', fallbackId || crd);

	return {
		id,
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
		searchText: normalizeText(`${id} ${name} ${otherNames.join(' ')} ${crd} ${individualId}`),
		externalLinks: individualId ? [{ label: 'BrokerCheck Profile', href: `https://brokercheck.finra.org/individual/summary/${individualId}` }] : [],
		detailSections: [],
	} as GraphNode;
}

function buildRawGraph() {
	const nodesById = new Map<string, GraphNode>();
	const links: GraphLink[] = [];
	const fileNames = fs.readdirSync(RAW_DATA_DIR);

	for (const fileName of fileNames) {
		if (!fileName.endsWith('.json')) continue;
		const filePath = path.join(RAW_DATA_DIR, fileName);
		const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
		const fileStem = fileName.replace(/\.json$/, '');
		const [namespace = DEFAULT_NAMESPACE, type] = fileStem.split(':');
		if (type === 'firm') {
			const firmNode = createFirmNodeFromRaw(raw, fileStem, namespace);
			nodesById.set(firmNode.id, firmNode);
			continue;
		}

		if (type === 'individual') {
			const personNode = createPersonNodeFromRaw(raw, fileStem, namespace);
			nodesById.set(personNode.id, personNode);

			const content = raw.content ?? raw;
			const currentEmployments = Array.isArray(content.currentEmployments) ? content.currentEmployments : [];
			const previousEmployments = Array.isArray(content.previousEmployments) ? content.previousEmployments : [];

			for (const employment of currentEmployments) {
				const firmId = String(employment.firmId ?? '');
				if (!firmId) continue;

				const firmKey = buildNodeId(namespace, 'firm', firmId);
				if (!nodesById.has(firmKey)) {
					const firmNode = createFirmNodeFromRaw(
						{ content: { basicInformation: { firmId, firmName: employment.firmName, firmBCScope: employment.firmBCScope } } },
						firmKey,
						namespace,
					);
					nodesById.set(firmKey, firmNode);
				}

				links.push({ source: personNode.id, target: firmKey, weight: 1, relationship: 'employment' });
			}

			for (const employment of previousEmployments) {
				const firmId = String(employment.firmId ?? '');
				if (!firmId) continue;
				const firmKey = buildNodeId(namespace, 'firm', firmId);
				if (!nodesById.has(firmKey)) {
					const firmNode = createFirmNodeFromRaw(
						{ content: { basicInformation: { firmId, firmName: employment.firmName, firmBCScope: employment.firmBCScope } } },
						firmKey,
						namespace,
					);
					nodesById.set(firmKey, firmNode);
				}
				links.push({ source: personNode.id, target: firmKey, weight: 1, relationship: 'disclosure' });
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

let cachedGraph: { nodes: GraphNode[]; links: GraphLink[]; adjacency: Map<string, Set<string>>; nodeById: Map<string, GraphNode> } | null = null;
function getGraphData() {
	if (!cachedGraph) cachedGraph = buildRawGraph();
	return cachedGraph;
}

export async function GET(request: Request) {
	const url = new URL(request.url);
	const idsParam = url.searchParams.get('ids') ?? '';
	const requested = idsParam
		.split(',')
		.map((s) => s.trim())
		.filter(Boolean);
	const { nodes, links, nodeById } = getGraphData();

	if (requested.length === 0) {
		return NextResponse.json({ visibleNodes: [], visibleLinks: [], visibleNodeIds: [] });
	}

	const requestedSet = new Set(requested);
	const visibleNodes = nodes.filter((n) => requestedSet.has(n.id));
	const visibleNodeIds = new Set(visibleNodes.map((n) => n.id));
	const visibleLinks = links.filter((l) => visibleNodeIds.has(getEndpointId(l.source)) && visibleNodeIds.has(getEndpointId(l.target)));

	return NextResponse.json({ visibleNodeIds: Array.from(visibleNodeIds), visibleNodes, visibleLinks, message: `Fetched ${visibleNodeIds.size} nodes by ids.` });
}
