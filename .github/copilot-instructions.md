# Copilot Instructions for `Cosmograph-fs`

- This repository is a single monorepo rooted at `Cosmograph-fs/` with the Next.js app in `web/` and the Rust/WASM simulation crate in `wasm-sim/`.
- Keep shared, repo-wide guidance in this file. Use `.github/instructions/*.instructions.md` only for file- or folder-scoped rules.
- The web app uses the Next.js App Router. Keep browser-only graph code inside Client Components marked with `'use client'`.
- Centralize graph node generation, adjacency shaping, visual defaults, and force-layout tuning in `web/src/lib/graph-data.ts`.
- Keep `web/src/components/GraphView.tsx` focused on rendering, force-graph configuration, and interaction behavior. Avoid inline graph generation logic there.
- Prefer typed graph node/link/layout contracts over `any` in the graph pipeline.
- Use `react-force-graph-2d` for browser-side force-directed animation and keep force tuning data-driven via the shared graph data layer.
- Prefer interaction patterns that reheat or refocus the simulation instead of hardcoding absolute node coordinates.
- If this repo later grows into a FINRA/SEC data app, keep canonical local data under `web/data/finra/` using normalized file-backed records for people, firms, relationships, and search indexes.
- If Redis is introduced later, treat it as an optional production-only cache layer; local development and non-prod environments must still boot without Redis.
