# Technical Specification: Cosmograph-fs

**Version**: 0.1.0 **Last Updated**: May 20, 2026 **Application Type**: Interactive Network Graph Visualization

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Architecture Overview](#architecture-overview)
3. [Technology Stack](#technology-stack)
4. [Data Model](#data-model)
5. [Component Architecture](#component-architecture)
6. [Graph Visualization System](#graph-visualization-system)
7. [Interaction Model](#interaction-model)
8. [Performance Optimization](#performance-optimization)
9. [State Management](#state-management)
10. [Future Architecture](#future-architecture)

---

## Executive Summary

Cosmograph-fs is a high-performance network graph visualization application designed to display and explore relationship networks between financial entities (firms and individuals). The application uses WebGL-accelerated rendering via Sigma.js and Graphology to handle large graphs with minimal latency, optimized for user-controlled exploration with stable, minimal-movement physics.

**Key Design Principles**:

- Performance-first rendering with WebGL
- User-controlled simulation (pause on hover, stop on click)
- Minimal animation for stability and precision
- Type-safe graph contracts throughout the pipeline
- Centralized data and configuration layer

---

## Architecture Overview

### Monorepo Structure

```
Cosmograph-fs/
├── web/                    # Next.js web application
│   ├── src/
│   │   ├── app/           # App Router pages and layouts
│   │   ├── components/    # React components
│   │   └── lib/           # Shared utilities and data layer
│   ├── public/            # Static assets
│   └── package.json
├── wasm-sim/              # Rust/WASM simulation crate (future)
└── .github/               # Repository configuration and docs
```

### Application Flow

```
User Interaction → React State → Graph Data Layer → Sigma Renderer (sigma.js + graphology) → WebGL Canvas
                                        ↓
                                  Adjacency Maps
                                  Search Index
                                  Visual Config
```

---

## Technology Stack

### Core Framework

| Technology     | Version | Purpose                              |
| -------------- | ------- | ------------------------------------ |
| **Next.js**    | 16.2.6  | React framework with App Router      |
| **React**      | 19.2.4  | UI component library                 |
| **TypeScript** | 5.x     | Type-safe development                |
| **pnpm**       | 10.22.0 | Fast, disk-efficient package manager |

### Visualization

| Technology                | Version                | Purpose                                                |
| ------------------------- | ---------------------- | ------------------------------------------------------ |
| **sigma.js + graphology** | (see web/package.json) | WebGL-based graph rendering and graph model/algorithms |

### Styling

| Technology               | Version | Purpose                     |
| ------------------------ | ------- | --------------------------- |
| **Tailwind CSS**         | 4.x     | Utility-first CSS framework |
| **@tailwindcss/postcss** | 4.x     | PostCSS integration         |

### Development Tools

| Tool                   | Version | Purpose                      |
| ---------------------- | ------- | ---------------------------- |
| **ESLint**             | 9.x     | Code linting                 |
| **eslint-config-next** | 16.2.6  | Next.js ESLint configuration |

---

## Data Model

### Core Types

#### GraphNode

Represents an entity (firm or individual) in the network.

#### GraphLink

Represents a relationship between two entities.

#### GraphDataset

Complete graph state with derived structures including adjacency maps, node lookups, and configuration.

### Derived Data Structures

- **Adjacency Map**: O(1) neighbor lookups
- **Links by Node**: Grouped links for efficient filtering
- **Node by ID**: Fast entity retrieval

---

## Component Architecture

### GraphView Component

**File**: \`src/components/GraphView.tsx\` **Type**: Client Component

#### Responsibilities

1. Rendering Sigma canvas with WebGL visualization
2. State management for selection, hover, search
3. Interaction handling (click, hover, search events)
4. Simulation control (pause/resume physics)
5. UI overlay (search bar, detail panel, controls)

---

## Graph Visualization System

### Sigma / Graphology Configuration

This project uses `sigma.js` for rendering and `graphology` (with optional force supervisors like ForceSupervisor or ForceAtlas2) for layout calculations. The UI exposes motion tuning controls for ForceAtlas2 (gravity, slowDown, scalingRatio, etc.) and an optional spring worker via `graphology-layout-force` when enabled.

#### Position Stability

**Problem**: Original implementation used `Math.random()` inside `useMemo` for initial node positions, causing non-deterministic behavior on every hover state change.

**Solution**: Deterministic position generation via string hashing:

```typescript
function getPseudoRandomOffset(seedString: string, range: number): number {
	let hash = 0;
	for (let i = 0; i < seedString.length; i++) {
		hash = (Math.imul(31, hash) + seedString.charCodeAt(i)) | 0;
	}
	return ((Math.abs(hash) % 10000) / 10000 - 0.5) * range * 2;
}

// Applied per-node:
x: node.x ?? getPseudoRandomOffset(`${node.id}-x`, 10);
y: node.y ?? getPseudoRandomOffset(`${node.id}-y`, 10);
```

This ensures nodes maintain stable positions across re-renders while preventing zero-distance initialization.

#### Available Customizations

- Event handlers (`clickNode`, `clickStage`, etc.)
- Node/link styling and sizing
- Camera controls and viewport fitting (via sigma camera API)
- Selection and highlight rendering

#### Physics Limitation

Fine-grained force-directed parameters can be tuned via ForceAtlas2 settings (exposed in the UI) or by using a dedicated force worker (graphology-layout-force). If more control is needed, the Rust/WASM `wasm-sim/` crate can be used to compute physics and stream positions back to the renderer.

### Node Types

- **Firms** (cyan): Broker-dealers and related financial firms
- **Individuals** (green): Registered representatives and officers

### Relationship Types

- **Employment**: Person-to-firm relationships
- **Control**: Ownership and control
- **Peer**: Firm-to-firm relationships
- **Disclosure**: Regulatory connections

---

## Interaction Model

### User Flow

1. **Initial Load**: Graph loads with seed firm and connections
2. **Hover**: Simulation pauses for easy selection
3. **Click**: Simulation stops permanently, node is pinned
4. **Selection**: Graph expands to show all connections
5. **Search**: Filter and reveal matching nodes
6. **Trace Mode**: Highlight complete relationship paths

### Event Handlers

- **onPointClick**: Stop simulation, expand graph, pin node
- **onPointMouseOver**: Pause simulation, highlight neighbors
- **onPointMouseOut**: Resume simulation (unless stopped)

---

## Performance Optimization

### Rendering

- WebGL acceleration via Cosmograph
- React memoization prevents unnecessary rerenders
- Selective visibility rendering

### Data Structures

- Hash maps for O(1) lookups
- Set operations for graph expansion
- Memoized expensive computations

### Simulation

- High friction (0.95) for fast convergence
- Low spring strength (0.1) for minimal oscillation
- Quick decay (1000 iterations)
- User-controlled pause/stop

---

## State Management

### React State Architecture

- **useState**: Local UI state
- **useMemo**: Derived data (visible graph, highlights, Cosmograph-formatted data)
- **useRef**: Cosmograph instance reference

### Immutability

- Dataset created once, never mutated
- State replaced, not modified
- All derived data uses immutable operations

---

## Future Architecture

### Phase 1: Live Data Integration

Connect to FINRA BrokerCheck and SEC AdviserInfo APIs with file-backed canonical data and optional Redis cache (production only).

### Phase 2: Custom Physics Control (Three Paths)

#### Option A: Library Migration

Switch to a library with exposed physics APIs (e.g., `react-force-graph`, `sigma.js`, `d3-force` directly). Provides immediate control without custom rendering.

**Effort**: Days **Benefits**: Full physics tuning, mature ecosystem **Drawbacks**: May lose Cosmograph's WebGL optimizations

#### Option B: Hybrid Rust/WASM Physics

Keep Cosmograph for rendering, but compute layout in the `wasm-sim/` crate using `petgraph` and force algorithms. Stream positions back to Cosmograph via Web Workers.

**Effort**: 1-2 weeks **Benefits**: Rust performance, off-thread compute, keep current renderer **Drawbacks**: Complex data synchronization, requires Worker setup

#### Option C: Full WebGPU Rewrite

Build complete visualization stack in Rust using `wgpu` crate. Write WGSL compute shaders for force-directed layout, render directly to canvas via WebGPU.

**Effort**: 4-8 weeks **Benefits**: Maximum control, GPU-accelerated physics AND rendering, native performance **Drawbacks**: Rebuild entire interaction layer, browser compatibility (WebGPU not universal), no React integration

**Recommendation**: Profile current implementation first. If bottleneck is layout math and node count >10K, pursue Option B. If rendering is also slow or custom effects needed, consider Option C.

### Phase 3: Advanced Features

- Graph algorithms (shortest path, community detection)
- Export/import functionality
- Collaboration features
- Analytics and metrics

---

## Development Guidelines

1. **Centralize Data Logic**: All graph generation in \`graph-data.ts\`
2. **Component Purity**: GraphView focuses on rendering
3. **Type Safety**: Strict TypeScript, no \`any\` types
4. **Consistent Naming**: Use descriptive, consistent patterns

---

## Deployment

### Build Process

```bash
pnpm install      # Install dependencies
pnpm build        # Next.js production build
pnpm start        # Production server
```

### Hosting Recommendations

- **Vercel**: Optimized for Next.js
- **Cloudflare Pages**: Global CDN
- **Self-hosted**: Node.js 20+ required

---

**Document Status**: Active **Maintainer**: Project Team **Review Cycle**: Quarterly or on major changes
