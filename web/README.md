# Cosmograph-fs Web Application

An interactive network graph visualization application built with Next.js and Sigma.js/graphology, designed to display relationship networks between firms and individuals in a FINRA/SEC-style data model.

## Overview

This application provides a high-performance, WebGL-accelerated force-directed graph visualization using [sigma.js](https://www.sigmajs.org) and [graphology](https://graphology.github.io/). It features interactive node selection, dynamic graph expansion, search functionality, and detailed entity views with a focus on minimal movement and user-controlled interactions.

## Key Features

- **High-Performance Rendering**: WebGL-based graph visualization using Cosmograph
- **Interactive Node Selection**: Click nodes to explore relationships and pin them in place
- **Dynamic Graph Expansion**: Automatically reveals connected nodes when selecting entities
- **Search Functionality**: Search firms and individuals by name with instant results
- **Trace Mode**: Visualize complete relationship paths between entities
- **Minimal Animation**: Highly damped physics simulation with user-controlled pausing
- **Responsive UI**: Side panel with entity details, badges, and external links
- **Selection History**: Track your exploration path through the graph

## Tech Stack

- **Framework**: Next.js 16.2.6 (App Router)
- **Runtime**: React 19.2.4
- **Visualization**: sigma.js + graphology
- **Styling**: Tailwind CSS 4
- **Language**: TypeScript 5
- **Package Manager**: pnpm 10.22.0

## Graph Visualization Details

### Cosmograph Configuration

The application uses Cosmograph with optimized parameters for stability and minimal movement:

- **Simulation Mode**: Force-directed layout
- **Repulsion**: 0.5 (reduced node pushing)
- **Link Spring**: 0.85 (strong springs to prevent graph explosion)
- **Link Distance**: 2 (compact local clusters)
- **Friction**: 0.4 (heavy damping for fast settling)
- **Decay**: 1000 iterations (fast cooldown)
- **Gravity**: 0.25 (center pull, increases to 1.5 for graphs with <10 nodes)
- **Pause on Interaction**: Simulation stops on hover and permanently on click
- **Node Pinning**: Selected nodes are tracked and pinned in place
- **Coordinate Initialization**: All nodes spawn with randomized coordinates to prevent zero-distance repulsion

### Node Types

- **Firms** (cyan): Broker-dealers and related financial firms
- **Individuals** (green): Registered representatives and officers

### Relationship Types

- **Employment**: Person-to-firm employment relationships
- **Control**: Ownership and control relationships
- **Peer**: Firm-to-firm peer relationships
- **Disclosure**: Regulatory disclosure connections

## Getting Started

From the repository root (`Cosmograph-fs/`), install dependencies with `pnpm`, then run the development server:

```bash
pnpm install
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

## Project Structure

```
web/
├── src/
│   ├── app/              # Next.js App Router pages
│   ├── components/       # React components
│   │   └── GraphView.tsx # Main graph visualization component
│   └── lib/
│       └── graph-data.ts # Graph data model and utilities
├── public/               # Static assets
└── package.json
```

## Key Components

### GraphView.tsx

The main visualization component that:

- Renders the Cosmograph canvas
- Handles node selection and interaction
- Manages simulation state and pausing
- Provides search and filter UI
- Displays entity detail panels

### graph-data.ts

Centralized graph data layer that defines:

- Type contracts for nodes, links, and relationships
- Graph generation and seed data
- Adjacency mapping and search utilities
- Visual and force configuration defaults

## Interaction Model

1. **Initial Load**: Graph loads with a seed firm and its immediate connections visible
2. **Hover**: Simulation pauses to enable easy selection
3. **Click**: Simulation stops permanently, clicked node is pinned
4. **Selection**: Expands graph to show all connected nodes
5. **Search**: Filter and reveal nodes matching search query
6. **Trace Mode**: Highlight complete relationship paths

## Configuration

Graph behavior is controlled via centralized configuration in `graph-data.ts`:

- **Visual Config**: Colors, sizes, stroke widths, label styles
- **Force Config**: Physics simulation parameters
- **Viewport Config**: Zoom, fit view, and focus animation settings

## Future Enhancements

- Integration with live FINRA BrokerCheck and SEC AdviserInfo APIs
- File-backed canonical data storage under `web/data/finra/`
- Optional Redis caching layer for production environments
- Enhanced search with prefix matching and typeahead
- Export and sharing functionality

## Resources

- [Cosmograph Documentation](https://cosmograph.app/)
- [Next.js Documentation](https://nextjs.org/docs)
- [Tailwind CSS](https://tailwindcss.com/)
- [Technical Specification](./TECHNICAL_SPEC.md)

## License

Private - All Rights Reserved
