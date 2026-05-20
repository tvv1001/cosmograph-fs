import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

function normalizeSearchQuery(value: string | null): string {
	return (value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

export function proxy(request: NextRequest) {
	if (request.nextUrl.pathname !== '/api/finra/search') {
		return NextResponse.next();
	}

	const currentQuery = request.nextUrl.searchParams.get('query');
	const normalizedQuery = normalizeSearchQuery(currentQuery);

	if (normalizedQuery !== (currentQuery ?? '')) {
		const rewriteUrl = request.nextUrl.clone();
		if (normalizedQuery) {
			rewriteUrl.searchParams.set('query', normalizedQuery);
		} else {
			rewriteUrl.searchParams.delete('query');
		}

		return NextResponse.rewrite(rewriteUrl);
	}

	const requestHeaders = new Headers(request.headers);
	requestHeaders.set('x-search-cache-key', normalizedQuery || '__empty__');

	return NextResponse.next({
		request: {
			headers: requestHeaders,
		},
	});
}

export const config = {
	matcher: ['/api/finra/search'],
};