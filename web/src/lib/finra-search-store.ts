import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createClient } from 'redis';

import type { GraphLink, GraphNode, GraphNodeKind, RelationshipKind, RemoteGraphSearchResult } from '@/lib/graph-data';
import { getIdSourceFlag } from '@/lib/graph-data';

const MAX_UPSTREAM_RESULTS = 8;
const LOCAL_MATCH_LIMIT = 12;
const LOCAL_QUERY_CACHE_TTL_MS = 2 * 60 * 1000;
const EXTERNAL_QUERY_CACHE_TTL_MS = 10 * 60 * 1000;
const LOCAL_ENTITY_CACHE_TTL_MS = 45 * 1000;
const UPSTREAM_FETCH_REVALIDATE_SECONDS = 10 * 60;

type SourceSystem = 'finra' | 'sec';

type UpstreamEmployment = {
	firm_id?: string;
	firm_name?: string;
	branch_city?: string;
	branch_state?: string;
	branch_zip?: string;
	ia_only?: string;
	firm_bd_sec_number?: string;
	firm_bd_full_sec_number?: string;
	firm_ia_sec_number?: string;
	firm_ia_full_sec_number?: string;
};

type UpstreamPersonSource = {
	ind_source_id?: string;
	ind_firstname?: string;
	ind_middlename?: string;
	ind_lastname?: string;
	ind_other_names?: string[];
	ind_bc_scope?: string;
	ind_ia_scope?: string;
	ind_bc_disclosure_fl?: string;
	ind_ia_disclosure_fl?: string;
	ind_approved_finra_registration_count?: number;
	ind_employments_count?: number;
	ind_current_employments?: UpstreamEmployment[];
	ind_ia_current_employments?: UpstreamEmployment[];
};

type UpstreamFirmSource = {
	firm_source_id?: string;
	firm_bd_sec_number?: string;
	firm_bd_full_sec_number?: string;
	firm_ia_sec_number?: string;
	firm_ia_full_sec_number?: string;
	firm_name?: string;
	firm_other_names?: string[];
	firm_scope?: string;
	firm_disclosure_fl?: string;
	firm_ia_disclosure_fl?: string;
	firm_approved_finra_registration_count?: number;
	firm_branches_count?: number;
};

type UpstreamSearchHit<T> = {
	_source?: T;
};

type UpstreamSearchResponse<T> = {
	hits?: {
		total?: number;
		hits?: Array<UpstreamSearchHit<T>>;
	};
};

type AggregatedPerson = {
	crd: string;
	firstName?: string;
	middleName?: string;
	lastName?: string;
	otherNames: Set<string>;
	bcScope?: string;
	iaScope?: string;
	bcDisclosure?: string;
	iaDisclosure?: string;
	approvedFinraRegistrationCount?: number;
	employmentsCount?: number;
	employments: Map<string, UpstreamEmployment>;
	sourceSystems: Set<SourceSystem>;
};

type AggregatedFirm = {
	crd: string;
	sec?: string;
	iaSec?: string;
	name?: string;
	otherNames: Set<string>;
	scope?: string;
	bcDisclosure?: string;
	iaDisclosure?: string;
	branchesCount?: number;
	approvedFinraRegistrationCount?: number;
	sourceSystems: Set<SourceSystem>;
};

type StoredEntityRecord = {
	id: string;
	kind: GraphNodeKind;
	crd: string;
	sec?: string;
	sourceSystems: SourceSystem[];
	updatedAt: string;
	node: GraphNode;
};

type StoredRelationshipRecord = {
	nodeId: string;
	relatedNodeIds: string[];
	links: Array<{
		source: string;
		target: string;
		weight: number;
		relationship: RelationshipKind;
	}>;
	updatedAt: string;
};

function resolveWebRoot(): string {
	const currentDirectory = process.cwd();
	return currentDirectory.endsWith(`${path.sep}web`) ? currentDirectory : path.join(currentDirectory, 'web');
}

const WEB_ROOT = resolveWebRoot();
const FINRA_DATA_DIRECTORY = path.join(WEB_ROOT, 'data', 'finra');
const PEOPLE_DIRECTORY = path.join(FINRA_DATA_DIRECTORY, 'entities', 'people');
const FIRMS_DIRECTORY = path.join(FINRA_DATA_DIRECTORY, 'entities', 'firms');
const RELATIONSHIPS_DIRECTORY = path.join(FINRA_DATA_DIRECTORY, 'relationships');
const REDIS_KEY_PREFIX = (process.env.REDIS_KEY_PREFIX ?? 'finra').trim() || 'finra';

type RedisCacheClient = ReturnType<typeof createClient>;

let redisClientPromise: Promise<RedisCacheClient | null> | null = null;
let localEntityCache: { records: StoredEntityRecord[]; expiresAt: number } | null = null;
const searchResultCache = new Map<string, { result: RemoteGraphSearchResult; expiresAt: number }>();

export async function searchFinraGraph(query: string): Promise<RemoteGraphSearchResult> {
	const normalizedQuery = normalizeSearchQuery(query);
	if (!normalizedQuery) {
		return {
			query: '',
			source: 'none',
			matchedNodeIds: [],
			primaryMatchId: null,
			nodes: [],
			links: [],
			addedToLocal: false,
			message: 'Enter a name, firm, or CRD/SEC# to expand the graph.',
		};
	}

	const cachedResult = readCachedSearchResult(normalizedQuery);
	if (cachedResult) {
		return cachedResult;
	}

	await ensureLocalDirectories();

	const localResult = await searchLocalGraph(normalizedQuery);
	if (localResult.matchedNodeIds.length > 0) {
		cacheSearchResult(normalizedQuery, localResult, LOCAL_QUERY_CACHE_TTL_MS);
		return localResult;
	}

	const externalResult = await fetchAndPersistExternalGraph(normalizedQuery);
	cacheSearchResult(normalizedQuery, externalResult, externalResult.source === 'external' ? EXTERNAL_QUERY_CACHE_TTL_MS : LOCAL_QUERY_CACHE_TTL_MS);
	return externalResult;
}

async function searchLocalGraph(normalizedQuery: string): Promise<RemoteGraphSearchResult> {
	const entities = await loadAllStoredEntities();
	const matchedEntities = entities
		.filter((entity) => entity.node.searchText.includes(normalizedQuery))
		.sort((left, right) => scoreSearchMatch(left.node.searchText, normalizedQuery) - scoreSearchMatch(right.node.searchText, normalizedQuery))
		.slice(0, LOCAL_MATCH_LIMIT);

	if (matchedEntities.length === 0) {
		return {
			query: normalizedQuery,
			source: 'none',
			matchedNodeIds: [],
			primaryMatchId: null,
			nodes: [],
			links: [],
			addedToLocal: false,
			message: `No local or upstream matches found for "${normalizedQuery}".`,
		};
	}

	const entityById = new Map(entities.map((entity) => [entity.id, entity]));
	const includedNodeIds = new Set(matchedEntities.map((entity) => entity.id));
	const relationshipMap = new Map<string, GraphLink>();

	for (const entity of matchedEntities) {
		const relationship = await readRelationshipRecord(entity.id);
		if (!relationship) continue;
		for (const relatedNodeId of relationship.relatedNodeIds) includedNodeIds.add(relatedNodeId);
		for (const link of relationship.links) relationshipMap.set(getSerializedLinkKey(link), link);
	}

	const nodes = Array.from(includedNodeIds)
		.map((nodeId) => entityById.get(nodeId)?.node)
		.filter((node): node is GraphNode => Boolean(node));

	return {
		query: normalizedQuery,
		source: 'local',
		matchedNodeIds: matchedEntities.map((entity) => entity.id),
		primaryMatchId: matchedEntities[0]?.id ?? null,
		nodes,
		links: Array.from(relationshipMap.values()),
		addedToLocal: false,
		message: `Loaded ${matchedEntities.length} locally cached match${matchedEntities.length === 1 ? '' : 'es'} for "${normalizedQuery}".`,
	};
}

async function fetchAndPersistExternalGraph(normalizedQuery: string): Promise<RemoteGraphSearchResult> {
	const [finraIndividuals, finraFirms, secIndividuals, secFirms] = await Promise.allSettled([
		fetchUpstreamSearch<UpstreamPersonSource>('https://api.brokercheck.finra.org/search/individual', normalizedQuery),
		fetchUpstreamSearch<UpstreamFirmSource>('https://api.brokercheck.finra.org/search/firm', normalizedQuery),
		fetchUpstreamSearch<UpstreamPersonSource>('https://api.adviserinfo.sec.gov/search/individual', normalizedQuery),
		fetchUpstreamSearch<UpstreamFirmSource>('https://api.adviserinfo.sec.gov/search/firm', normalizedQuery),
	]);

	const personMap = new Map<string, AggregatedPerson>();
	const firmMap = new Map<string, AggregatedFirm>();

	mergePersonSearchResults(personMap, firmMap, getSettledValue(finraIndividuals), 'finra');
	mergeFirmSearchResults(firmMap, getSettledValue(finraFirms), 'finra');
	mergePersonSearchResults(personMap, firmMap, getSettledValue(secIndividuals), 'sec');
	mergeFirmSearchResults(firmMap, getSettledValue(secFirms), 'sec');

	const nodes: GraphNode[] = [];
	const nodeById = new Map<string, GraphNode>();
	const links: GraphLink[] = [];
	const linkMap = new Map<string, GraphLink>();
	const storedEntities: StoredEntityRecord[] = [];
	const relationshipAccumulator = new Map<string, StoredRelationshipRecord>();
	const now = new Date().toISOString();

	for (const person of personMap.values()) {
		const node = createGraphPersonNode(person);
		nodes.push(node);
		nodeById.set(node.id, node);
		storedEntities.push({
			id: node.id,
			kind: 'individual',
			crd: person.crd,
			sourceSystems: Array.from(person.sourceSystems),
			updatedAt: now,
			node,
		});
	}

	for (const firm of firmMap.values()) {
		const node = createGraphFirmNode(firm);
		nodes.push(node);
		nodeById.set(node.id, node);
		storedEntities.push({
			id: node.id,
			kind: 'firm',
			crd: firm.crd,
			sec: firm.sec ?? firm.iaSec,
			sourceSystems: Array.from(firm.sourceSystems),
			updatedAt: now,
			node,
		});
	}

	for (const person of personMap.values()) {
		const personNodeId = `person-${person.crd}`;
		for (const employment of person.employments.values()) {
			const firmCrd = normalizeIdentifier(employment.firm_id);
			if (!firmCrd) continue;
			const firmNodeId = `firm-${firmCrd}`;
			if (!nodeById.has(personNodeId) || !nodeById.has(firmNodeId)) continue;
			const link: GraphLink = {
				source: personNodeId,
				target: firmNodeId,
				weight: 2,
				relationship: 'employment',
			};
			linkMap.set(getSerializedLinkKey(link), link);
			appendRelationship(relationshipAccumulator, personNodeId, link, firmNodeId, now);
			appendRelationship(relationshipAccumulator, firmNodeId, link, personNodeId, now);
		}
	}

	links.push(...Array.from(linkMap.values()));

	const matchedNodes = nodes
		.filter((node) => node.searchText.includes(normalizedQuery))
		.sort((left, right) => scoreSearchMatch(left.searchText, normalizedQuery) - scoreSearchMatch(right.searchText, normalizedQuery));

	if (matchedNodes.length === 0) {
		return {
			query: normalizedQuery,
			source: 'none',
			matchedNodeIds: [],
			primaryMatchId: null,
			nodes: [],
			links: [],
			addedToLocal: false,
			message: `No local or upstream matches found for "${normalizedQuery}".`,
		};
	}

	await Promise.all([
		...storedEntities.map((entity) => writeEntityRecord(entity)),
		...Array.from(relationshipAccumulator.values()).map((relationship) => writeRelationshipRecord(relationship)),
	]);

	return {
		query: normalizedQuery,
		source: 'external',
		matchedNodeIds: matchedNodes.map((node) => node.id),
		primaryMatchId: matchedNodes[0]?.id ?? null,
		nodes,
		links,
		addedToLocal: true,
		message: `Fetched ${matchedNodes.length} upstream match${matchedNodes.length === 1 ? '' : 'es'} for "${normalizedQuery}" and saved them locally.`,
	};
}

async function fetchUpstreamSearch<T>(endpoint: string, query: string): Promise<UpstreamSearchResponse<T>> {
	const url = new URL(endpoint);
	url.searchParams.set('query', query);
	url.searchParams.set('hl', 'true');
	url.searchParams.set('wt', 'json');
	url.searchParams.set('nrows', `${MAX_UPSTREAM_RESULTS}`);
	url.searchParams.set('start', '0');

	const response = await fetch(url, {
		headers: {
			'Accept': 'application/json',
			'User-Agent': 'Mozilla/5.0',
		},
		next: {
			revalidate: UPSTREAM_FETCH_REVALIDATE_SECONDS,
		},
	});

	if (!response.ok) {
		throw new Error(`Upstream request failed with ${response.status} for ${url}`);
	}

	return (await response.json()) as UpstreamSearchResponse<T>;
}

function mergePersonSearchResults(
	personMap: Map<string, AggregatedPerson>,
	firmMap: Map<string, AggregatedFirm>,
	response: UpstreamSearchResponse<UpstreamPersonSource> | null,
	sourceSystem: SourceSystem,
): void {
	for (const hit of response?.hits?.hits ?? []) {
		const source = hit._source;
		const crd = normalizeIdentifier(source?.ind_source_id);
		if (!crd) continue;

		const person = personMap.get(crd) ?? {
			crd,
			otherNames: new Set<string>(),
			employments: new Map<string, UpstreamEmployment>(),
			sourceSystems: new Set<SourceSystem>(),
		};

		person.firstName ??= source?.ind_firstname;
		person.middleName ??= source?.ind_middlename;
		person.lastName ??= source?.ind_lastname;
		person.bcScope ??= source?.ind_bc_scope;
		person.iaScope ??= source?.ind_ia_scope;
		person.bcDisclosure ??= source?.ind_bc_disclosure_fl;
		person.iaDisclosure ??= source?.ind_ia_disclosure_fl;
		person.approvedFinraRegistrationCount = Math.max(person.approvedFinraRegistrationCount ?? 0, source?.ind_approved_finra_registration_count ?? 0);
		person.employmentsCount = Math.max(person.employmentsCount ?? 0, source?.ind_employments_count ?? 0);
		person.sourceSystems.add(sourceSystem);

		for (const alias of source?.ind_other_names ?? []) if (alias.trim()) person.otherNames.add(alias.trim());
		for (const employment of [...(source?.ind_current_employments ?? []), ...(source?.ind_ia_current_employments ?? [])]) {
			const employmentKey = normalizeIdentifier(employment.firm_id) ?? `${employment.firm_name ?? 'firm'}-${employment.branch_city ?? ''}-${employment.branch_state ?? ''}`;
			person.employments.set(employmentKey, employment);
			mergeEmploymentFirm(firmMap, employment, sourceSystem);
		}

		personMap.set(crd, person);
	}
}

function mergeFirmSearchResults(firmMap: Map<string, AggregatedFirm>, response: UpstreamSearchResponse<UpstreamFirmSource> | null, sourceSystem: SourceSystem): void {
	for (const hit of response?.hits?.hits ?? []) {
		const source = hit._source;
		const crd = normalizeIdentifier(source?.firm_source_id);
		if (!crd) continue;

		const firm = firmMap.get(crd) ?? {
			crd,
			otherNames: new Set<string>(),
			sourceSystems: new Set<SourceSystem>(),
		};

		firm.name ??= source?.firm_name;
		firm.sec ??= normalizeSecIdentifier(source?.firm_bd_full_sec_number ?? source?.firm_bd_sec_number, '8-');
		firm.iaSec ??= normalizeSecIdentifier(source?.firm_ia_full_sec_number ?? source?.firm_ia_sec_number, '801-');
		firm.scope ??= source?.firm_scope;
		firm.bcDisclosure ??= source?.firm_disclosure_fl;
		firm.iaDisclosure ??= source?.firm_ia_disclosure_fl;
		firm.branchesCount = Math.max(firm.branchesCount ?? 0, source?.firm_branches_count ?? 0);
		firm.approvedFinraRegistrationCount = Math.max(firm.approvedFinraRegistrationCount ?? 0, source?.firm_approved_finra_registration_count ?? 0);
		firm.sourceSystems.add(sourceSystem);
		for (const alias of source?.firm_other_names ?? []) if (alias.trim()) firm.otherNames.add(alias.trim());

		firmMap.set(crd, firm);
	}
}

function mergeEmploymentFirm(firmMap: Map<string, AggregatedFirm>, employment: UpstreamEmployment, sourceSystem: SourceSystem): void {
	const crd = normalizeIdentifier(employment.firm_id);
	if (!crd) return;

	const firm = firmMap.get(crd) ?? {
		crd,
		otherNames: new Set<string>(),
		sourceSystems: new Set<SourceSystem>(),
	};

	firm.name ??= employment.firm_name;
	firm.sec ??= normalizeSecIdentifier(employment.firm_bd_full_sec_number ?? employment.firm_bd_sec_number, '8-');
	firm.iaSec ??= normalizeSecIdentifier(employment.firm_ia_full_sec_number ?? employment.firm_ia_sec_number, '801-');
	firm.sourceSystems.add(sourceSystem);
	firmMap.set(crd, firm);
}

function createGraphPersonNode(person: AggregatedPerson): GraphNode {
	const name = formatPersonName(person);
	const aliases = Array.from(person.otherNames).filter((alias) => alias.toLowerCase() !== name.toLowerCase());
	const employments = Array.from(person.employments.values());
	const hasDisclosure = person.bcDisclosure === 'Y' || person.iaDisclosure === 'Y';
	const scopeSummary = getIndividualScopeSummary(person.bcScope, person.iaScope);
	const sourceFlag = getIdSourceFlag(person.sourceSystems.has('finra'), person.sourceSystems.has('sec'));
	const employmentSummary = employments[0]?.firm_name ? `Currently associated with ${titleCase(employments[0].firm_name)}.` : 'Upstream match fetched from FINRA/SEC search.';
	const detailSections = [
		{
			title: 'Profile',
			items: [
				{ label: 'CRD', value: person.crd },
				...(sourceFlag ? [{ label: 'ID source flag', value: sourceFlag }] : []),
				{ label: 'ID source check', value: formatSourceSystems(person.sourceSystems) },
				{ label: 'BrokerCheck scope', value: person.bcScope ?? 'Unknown' },
				{ label: 'IAPD scope', value: person.iaScope ?? 'Unknown' },
				{ label: 'Approved FINRA registrations', value: `${person.approvedFinraRegistrationCount ?? 0}` },
			],
		},
		{
			title: 'Current Employment',
			items:
				employments.length > 0 ?
					employments.map((employment) => ({
						label: titleCase(employment.firm_name ?? 'Unknown firm'),
						value: [employment.branch_city, employment.branch_state].filter(Boolean).join(', ') || 'Location unavailable',
					}))
				:	[{ label: 'Status', value: 'No current employment records returned by upstream search.' }],
		},
	];

	if (aliases.length > 0) {
		detailSections.push({
			title: 'Other Names',
			items: aliases.slice(0, 6).map((alias) => ({ label: 'Alias', value: titleCase(alias) })),
		});
	}

	return {
		id: `person-${person.crd}`,
		label: name,
		kind: 'individual',
		degreeHint: 0,
		size: 5,
		isHub: false,
		title: name,
		identifierLine: sourceFlag ? `CRD#: ${person.crd} · ${sourceFlag}` : `CRD#: ${person.crd}`,
		sourceFlag,
		badges: [
			{ label: scopeSummary, tone: person.bcScope?.toLowerCase() === 'active' || person.iaScope?.toLowerCase() === 'active' ? 'success' : 'warning' },
			...(sourceFlag ? [{ label: sourceFlag, tone: 'info' as const }] : []),
			{ label: hasDisclosure ? 'Disclosures 1+' : 'Disclosures 0', tone: hasDisclosure ? 'warning' : 'neutral' },
		],
		marker: 'I',
		summary: employmentSummary,
		subtitle:
			aliases.length > 0 ?
				aliases
					.slice(0, 3)
					.map((alias) => titleCase(alias))
					.join(', ')
			:	undefined,
		searchText: `${name} ${aliases.join(' ')} ${person.crd}`.toLowerCase(),
		externalLinks: [
			{ label: 'BrokerCheck Profile', href: `https://brokercheck.finra.org/individual/summary/${person.crd}` },
			{ label: 'IAPD Detail (JSON)', href: `https://api.adviserinfo.sec.gov/search/individual/${person.crd}?wt=json` },
		],
		detailSections,
	};
}

function createGraphFirmNode(firm: AggregatedFirm): GraphNode {
	const name = titleCase(firm.name ?? `Firm ${firm.crd}`);
	const aliases = Array.from(firm.otherNames).filter((alias) => alias.toLowerCase() !== name.toLowerCase());
	const hasDisclosure = firm.bcDisclosure === 'Y' || firm.iaDisclosure === 'Y';
	const scopeLabel = titleCase(firm.scope ?? 'Unknown');
	const sourceFlag = getIdSourceFlag(firm.sourceSystems.has('finra'), firm.sourceSystems.has('sec'));
	const secIdentifier = firm.sec ?? firm.iaSec ?? 'Unknown';
	const detailSections = [
		{
			title: 'Registration',
			items: [
				{ label: 'CRD', value: firm.crd },
				...(sourceFlag ? [{ label: 'ID source flag', value: sourceFlag }] : []),
				{ label: 'ID source check', value: formatSourceSystems(firm.sourceSystems) },
				{ label: 'Scope', value: scopeLabel },
				{ label: 'SEC identifier', value: secIdentifier },
				{ label: 'Branch count', value: `${firm.branchesCount ?? 0}` },
			],
		},
	];

	if (aliases.length > 0) {
		detailSections.push({
			title: 'Other Names',
			items: aliases.slice(0, 6).map((alias) => ({ label: 'Alias', value: titleCase(alias) })),
		});
	}

	return {
		id: `firm-${firm.crd}`,
		label: name,
		kind: 'firm',
		degreeHint: 0,
		size: 10,
		isHub: true,
		title: name,
		identifierLine: sourceFlag ? `CRD#: ${firm.crd} / SEC#: ${secIdentifier} · ${sourceFlag}` : `CRD#: ${firm.crd} / SEC#: ${secIdentifier}`,
		sourceFlag,
		badges: [
			{ label: scopeLabel, tone: scopeLabel.toLowerCase() === 'active' ? 'success' : 'warning' },
			...(sourceFlag ? [{ label: sourceFlag, tone: 'info' as const }] : []),
			{ label: hasDisclosure ? 'Disclosures 1+' : 'Disclosures 0', tone: hasDisclosure ? 'warning' : 'neutral' },
		],
		marker: 'B',
		summary: `${scopeLabel} firm returned from upstream lookup.`,
		subtitle:
			aliases.length > 0 ?
				aliases
					.slice(0, 3)
					.map((alias) => titleCase(alias))
					.join(', ')
			:	undefined,
		searchText: `${name} ${aliases.join(' ')} ${firm.crd} ${firm.sec ?? ''} ${firm.iaSec ?? ''}`.toLowerCase(),
		externalLinks: [
			{ label: 'FINRA Summary', href: `https://brokercheck.finra.org/firm/summary/${firm.crd}` },
			{ label: 'SEC Detail (JSON)', href: `https://api.adviserinfo.sec.gov/search/firm/${firm.crd}?wt=json` },
		],
		detailSections,
	};
}

async function loadAllStoredEntities(): Promise<StoredEntityRecord[]> {
	const redisClient = await getRedisClient();
	if (redisClient) {
		const [peopleRecords, firmRecords] = await Promise.all([readRedisEntityRecords(redisClient, 'individual'), readRedisEntityRecords(redisClient, 'firm')]);
		return [...peopleRecords, ...firmRecords];
	}

	const now = Date.now();
	if (localEntityCache && localEntityCache.expiresAt > now) {
		return localEntityCache.records;
	}

	const [peopleRecords, firmRecords] = await Promise.all([readEntityRecords(PEOPLE_DIRECTORY), readEntityRecords(FIRMS_DIRECTORY)]);
	const records = [...peopleRecords, ...firmRecords];
	localEntityCache = {
		records,
		expiresAt: now + LOCAL_ENTITY_CACHE_TTL_MS,
	};
	return records;
}

async function readEntityRecords(directory: string): Promise<StoredEntityRecord[]> {
	try {
		const files = await fs.readdir(directory);
		const records = await Promise.all(files.filter((file) => file.endsWith('.json')).map((file) => readJsonFile<StoredEntityRecord>(path.join(directory, file))));
		return records.filter((record): record is StoredEntityRecord => Boolean(record)).map(normalizeStoredEntityRecord);
	} catch {
		return [];
	}
}

async function readRelationshipRecord(nodeId: string): Promise<StoredRelationshipRecord | null> {
	const redisClient = await getRedisClient();
	if (redisClient) {
		return readRedisJson<StoredRelationshipRecord>(redisClient, getRedisRelationshipKey(nodeId));
	}

	return readJsonFile<StoredRelationshipRecord>(path.join(RELATIONSHIPS_DIRECTORY, `${sanitizeFileName(nodeId)}.json`));
}

async function writeEntityRecord(record: StoredEntityRecord): Promise<void> {
	invalidateLocalSearchCaches();
	const redisClient = await getRedisClient();
	if (redisClient) {
		const redisKey = getRedisEntityKey(record.kind, record.crd);
		const existing = await readRedisJson<StoredEntityRecord>(redisClient, redisKey);
		const mergedRecord: StoredEntityRecord = existing ? mergeEntityRecords(existing, record) : record;
		await writeRedisJson(redisClient, redisKey, mergedRecord);
		await redisClient.sAdd(getRedisEntitySetKey(record.kind), redisKey);
		return;
	}

	const directory = record.kind === 'individual' ? PEOPLE_DIRECTORY : FIRMS_DIRECTORY;
	const filePath = path.join(directory, `${sanitizeFileName(record.crd)}.json`);
	const existing = await readJsonFile<StoredEntityRecord>(filePath);
	const mergedRecord: StoredEntityRecord = existing ? mergeEntityRecords(existing, record) : record;
	await fs.writeFile(filePath, `${JSON.stringify(mergedRecord, null, 2)}\n`, 'utf8');
}

async function writeRelationshipRecord(record: StoredRelationshipRecord): Promise<void> {
	invalidateLocalSearchCaches();
	const redisClient = await getRedisClient();
	if (redisClient) {
		const redisKey = getRedisRelationshipKey(record.nodeId);
		const existing = await readRedisJson<StoredRelationshipRecord>(redisClient, redisKey);
		const mergedRecord = existing ? mergeRelationshipRecords(existing, record) : record;
		await writeRedisJson(redisClient, redisKey, mergedRecord);
		await redisClient.sAdd(getRedisRelationshipSetKey(), redisKey);
		return;
	}

	const filePath = path.join(RELATIONSHIPS_DIRECTORY, `${sanitizeFileName(record.nodeId)}.json`);
	const existing = await readJsonFile<StoredRelationshipRecord>(filePath);
	const mergedRecord = existing ? mergeRelationshipRecords(existing, record) : record;
	await fs.writeFile(filePath, `${JSON.stringify(mergedRecord, null, 2)}\n`, 'utf8');
}

function mergeEntityRecords(existing: StoredEntityRecord, incoming: StoredEntityRecord): StoredEntityRecord {
	const mergedSourceSystems = Array.from(new Set([...existing.sourceSystems, ...incoming.sourceSystems])).sort() as SourceSystem[];
	const mergedSourceFlag = getIdSourceFlag(mergedSourceSystems.includes('finra'), mergedSourceSystems.includes('sec'));
	const mergedNode = {
		...existing.node,
		...incoming.node,
		externalLinks: dedupeExternalLinks([...existing.node.externalLinks, ...incoming.node.externalLinks]),
		detailSections: syncDetailSourceMetadata(
			incoming.node.detailSections.length > 0 ? incoming.node.detailSections : existing.node.detailSections,
			mergedSourceSystems,
			mergedSourceFlag,
		),
		searchText: `${existing.node.searchText} ${incoming.node.searchText}`.trim().toLowerCase(),
		sourceFlag: mergedSourceFlag,
		identifierLine: syncIdentifierLineSourceFlag(incoming.node.identifierLine || existing.node.identifierLine, mergedSourceFlag),
		badges: syncBadgeSourceFlag([...existing.node.badges, ...incoming.node.badges], mergedSourceFlag),
	};

	return {
		...incoming,
		sourceSystems: mergedSourceSystems,
		node: mergedNode,
	};
}

function normalizeStoredEntityRecord(record: StoredEntityRecord): StoredEntityRecord {
	const sourceFlag = getIdSourceFlag(record.sourceSystems.includes('finra'), record.sourceSystems.includes('sec'));
	return {
		...record,
		node: {
			...record.node,
			sourceFlag,
			identifierLine: syncIdentifierLineSourceFlag(record.node.identifierLine, sourceFlag),
			badges: syncBadgeSourceFlag(record.node.badges, sourceFlag),
			detailSections: syncDetailSourceMetadata(record.node.detailSections, record.sourceSystems, sourceFlag),
		},
	};
}

function mergeRelationshipRecords(existing: StoredRelationshipRecord, incoming: StoredRelationshipRecord): StoredRelationshipRecord {
	const linkMap = new Map<string, StoredRelationshipRecord['links'][number]>();
	for (const link of [...existing.links, ...incoming.links]) linkMap.set(getSerializedLinkKey(link), link);
	return {
		...incoming,
		relatedNodeIds: Array.from(new Set([...existing.relatedNodeIds, ...incoming.relatedNodeIds])).sort(),
		links: Array.from(linkMap.values()),
	};
}

function appendRelationship(relationshipAccumulator: Map<string, StoredRelationshipRecord>, nodeId: string, link: GraphLink, relatedNodeId: string, updatedAt: string): void {
	const record = relationshipAccumulator.get(nodeId) ?? {
		nodeId,
		relatedNodeIds: [],
		links: [],
		updatedAt,
	};

	record.relatedNodeIds = Array.from(new Set([...record.relatedNodeIds, relatedNodeId]));
	const linkKey = getSerializedLinkKey(link);
	if (!record.links.some((existingLink) => getSerializedLinkKey(existingLink) === linkKey)) {
		record.links.push({
			source: String(link.source),
			target: String(link.target),
			weight: link.weight,
			relationship: link.relationship,
		});
	}
	relationshipAccumulator.set(nodeId, record);
}

async function ensureLocalDirectories(): Promise<void> {
	if (await getRedisClient()) {
		return;
	}

	await Promise.all([fs.mkdir(PEOPLE_DIRECTORY, { recursive: true }), fs.mkdir(FIRMS_DIRECTORY, { recursive: true }), fs.mkdir(RELATIONSHIPS_DIRECTORY, { recursive: true })]);
}

function readCachedSearchResult(query: string): RemoteGraphSearchResult | null {
	const cachedEntry = searchResultCache.get(query);
	if (!cachedEntry) {
		return null;
	}

	if (cachedEntry.expiresAt <= Date.now()) {
		searchResultCache.delete(query);
		return null;
	}

	return cachedEntry.result;
}

function cacheSearchResult(query: string, result: RemoteGraphSearchResult, ttlMs: number): void {
	searchResultCache.set(query, {
		result,
		expiresAt: Date.now() + ttlMs,
	});
}

function invalidateLocalSearchCaches(): void {
	localEntityCache = null;
	searchResultCache.clear();
}

async function readJsonFile<T>(filePath: string): Promise<T | null> {
	try {
		const fileContents = await fs.readFile(filePath, 'utf8');
		return JSON.parse(fileContents) as T;
	} catch {
		return null;
	}
}

async function getRedisClient(): Promise<RedisCacheClient | null> {
	const redisUrl = process.env.REDIS_URL?.trim();
	if (!redisUrl) {
		return null;
	}

	if (!redisClientPromise) {
		redisClientPromise = (async () => {
			try {
				const client = createClient({ url: redisUrl });
				client.on('error', (error: unknown) => {
					console.error('Redis cache error:', error);
				});
				await client.connect();
				return client;
			} catch (error) {
				console.error('Unable to connect to Redis cache, falling back to local files.', error);
				return null;
			}
		})();
	}

	return redisClientPromise;
}

async function readRedisEntityRecords(redisClient: RedisCacheClient, kind: StoredEntityRecord['kind']): Promise<StoredEntityRecord[]> {
	const keys = await redisClient.sMembers(getRedisEntitySetKey(kind));
	if (keys.length === 0) {
		return [];
	}

	const records = await Promise.all(keys.map((key: string) => readRedisJson<StoredEntityRecord>(redisClient, key)));
	return records.filter((record: StoredEntityRecord | null): record is StoredEntityRecord => Boolean(record)).map(normalizeStoredEntityRecord);
}

async function readRedisJson<T>(redisClient: RedisCacheClient, key: string): Promise<T | null> {
	try {
		const rawValue = await redisClient.get(key);
		return rawValue ? (JSON.parse(rawValue) as T) : null;
	} catch {
		return null;
	}
}

async function writeRedisJson(redisClient: RedisCacheClient, key: string, value: unknown): Promise<void> {
	await redisClient.set(key, JSON.stringify(value));
}

function getRedisEntitySetKey(kind: StoredEntityRecord['kind']): string {
	return `${REDIS_KEY_PREFIX}:entities:${kind === 'individual' ? 'people' : 'firms'}`;
}

function getRedisEntityKey(kind: StoredEntityRecord['kind'], crd: string): string {
	return `${getRedisEntitySetKey(kind)}:${sanitizeFileName(crd)}`;
}

function getRedisRelationshipSetKey(): string {
	return `${REDIS_KEY_PREFIX}:relationships`;
}

function getRedisRelationshipKey(nodeId: string): string {
	return `${getRedisRelationshipSetKey()}:${sanitizeFileName(nodeId)}`;
}

function getSettledValue<T>(result: PromiseSettledResult<T>): T | null {
	return result.status === 'fulfilled' ? result.value : null;
}

function formatPersonName(person: AggregatedPerson): string {
	const parts = [person.firstName, person.middleName, person.lastName].filter(Boolean).map((part) => titleCase(part ?? ''));
	return parts.length > 0 ? parts.join(' ') : `Person ${person.crd}`;
}

function getIndividualScopeSummary(bcScope?: string, iaScope?: string): string {
	const normalizedBcScope = bcScope?.toLowerCase();
	const normalizedIaScope = iaScope?.toLowerCase();
	if (normalizedBcScope === 'active' && normalizedIaScope === 'active') return 'Broker & IA';
	if (normalizedBcScope === 'active') return 'Broker';
	if (normalizedIaScope === 'active') return 'Investment Adviser';
	if (normalizedBcScope === 'inactive' || normalizedIaScope === 'inactive') return 'Previously Registered';
	return 'Upstream Match';
}

function formatSourceSystems(sourceSystems: Set<SourceSystem>): string {
	return `FINRA=${sourceSystems.has('finra')} · SEC=${sourceSystems.has('sec')}`;
}

function syncDetailSourceMetadata(
	details: GraphNode['detailSections'],
	sourceSystems: SourceSystem[],
	sourceFlag: ReturnType<typeof getIdSourceFlag>,
): GraphNode['detailSections'] {
	return details.map((section) => {
		if (!section.items || !section.items.some((item) => item.label === 'ID source check' || item.label === 'ID source flag')) {
			return section;
		}

		const nextItems = section.items.filter((item) => item.label !== 'ID source check' && item.label !== 'ID source flag');
		const rebuiltItems = [] as typeof nextItems;
		let insertedMetadata = false;

		for (const item of nextItems) {
			rebuiltItems.push(item);
			if (!insertedMetadata && item.label === 'CRD') {
				if (sourceFlag) {
					rebuiltItems.push({ label: 'ID source flag', value: sourceFlag });
				}
				rebuiltItems.push({
					label: 'ID source check',
					value: `FINRA=${sourceSystems.includes('finra')} · SEC=${sourceSystems.includes('sec')}`,
				});
				insertedMetadata = true;
			}
		}

		if (!insertedMetadata) {
			if (sourceFlag) {
				rebuiltItems.unshift({ label: 'ID source flag', value: sourceFlag });
			}
			rebuiltItems.unshift({
				label: 'ID source check',
				value: `FINRA=${sourceSystems.includes('finra')} · SEC=${sourceSystems.includes('sec')}`,
			});
		}

		return {
			...section,
			items: rebuiltItems,
		};
	});
}

function syncIdentifierLineSourceFlag(identifierLine: string, sourceFlag: ReturnType<typeof getIdSourceFlag>): string {
	const baseIdentifierLine = identifierLine.replace(/ · (finra only|sec only|both finra_sec)$/i, '');
	return sourceFlag ? `${baseIdentifierLine} · ${sourceFlag}` : baseIdentifierLine;
}

function syncBadgeSourceFlag(badges: GraphNode['badges'], sourceFlag: ReturnType<typeof getIdSourceFlag>): GraphNode['badges'] {
	const nextBadges = badges.filter((badge) => !/^(finra only|sec only|both finra_sec)$/i.test(badge.label));
	if (sourceFlag) {
		nextBadges.push({ label: sourceFlag, tone: 'info' });
	}
	return nextBadges;
}

function normalizeSearchQuery(value: string): string {
	return value.trim().toLowerCase();
}

function normalizeIdentifier(value?: string): string | null {
	const normalized = value?.trim();
	return normalized ? normalized : null;
}

function normalizeSecIdentifier(value: string | undefined, prefix: string): string | undefined {
	const normalized = value?.trim();
	if (!normalized) return undefined;
	return normalized.includes('-') ? normalized : `${prefix}${normalized}`;
}

function titleCase(value: string): string {
	return value
		.toLowerCase()
		.split(/\s+/)
		.filter(Boolean)
		.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
		.join(' ');
}

function scoreSearchMatch(haystack: string, needle: string): number {
	const index = haystack.indexOf(needle);
	return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}

function sanitizeFileName(value: string): string {
	return value.replace(/[^a-zA-Z0-9_-]/g, '_');
}

function dedupeExternalLinks(links: GraphNode['externalLinks']): GraphNode['externalLinks'] {
	const linkMap = new Map<string, GraphNode['externalLinks'][number]>();
	for (const link of links) linkMap.set(`${link.label}:${link.href}`, link);
	return Array.from(linkMap.values());
}

function getSerializedLinkKey(link: { source: string | GraphNode; target: string | GraphNode; relationship?: RelationshipKind }): string {
	const source = typeof link.source === 'string' ? link.source : link.source.id;
	const target = typeof link.target === 'string' ? link.target : link.target.id;
	const pairKey = source < target ? `${source}:${target}` : `${target}:${source}`;
	return `${pairKey}:${link.relationship ?? 'employment'}`;
}
