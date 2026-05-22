'use client';

import dynamic from 'next/dynamic';
import React from 'react';

// Compatibility wrapper: render the Sigma-based view in place of the previous
// Cosmograph-based GraphView. This keeps the route stable while removing the
// @cosmograph/react dependency.
const SigmaGraphView = dynamic(() => import('./SigmaGraphView'), { ssr: false });

export default function GraphView() {
	return <SigmaGraphView />;
}
