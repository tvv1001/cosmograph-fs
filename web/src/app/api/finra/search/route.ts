import { NextResponse } from 'next/server';

import { searchFinraGraph } from '@/lib/finra-search-store';

export const runtime = 'nodejs';

function getSearchCacheControl(source: 'local' | 'external' | 'none'): string {
	switch (source) {
		case 'external':
			return 'public, max-age=300, stale-while-revalidate=1800';
		case 'local':
			return 'public, max-age=120, stale-while-revalidate=600';
		case 'none':
		default:
			return 'public, max-age=30, stale-while-revalidate=120';
	}
}

export async function GET(request: Request) {
	const { searchParams } = new URL(request.url);
	const query = searchParams.get('query') ?? '';

	try {
		const result = await searchFinraGraph(query);
		return NextResponse.json(result, {
			headers: {
				'Cache-Control': getSearchCacheControl(result.source),
				'X-Search-Source': result.source,
			},
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Unknown search failure.';
		return NextResponse.json(
			{
				query,
				source: 'none',
				matchedNodeIds: [],
				primaryMatchId: null,
				nodes: [],
				links: [],
				addedToLocal: false,
				message: `FINRA/SEC lookup failed: ${message}`,
			},
			{
				status: 500,
				headers: {
					'Cache-Control': 'no-store',
				},
			},
		);
	}
}
