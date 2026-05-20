import { NextResponse } from 'next/server';

import { searchFinraGraph } from '@/lib/finra-search-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
	const { searchParams } = new URL(request.url);
	const query = searchParams.get('query') ?? '';

	try {
		const result = await searchFinraGraph(query);
		return NextResponse.json(result);
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
			{ status: 500 },
		);
	}
}
