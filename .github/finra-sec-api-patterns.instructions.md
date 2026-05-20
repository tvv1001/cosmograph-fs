---
name: FINRA SEC API Pattern Guidelines
description: 'Imported planning guidance for a future FINRA/SEC data app. The local canonical data model and prod-only Redis cache stance are defined here, but this repo still has no FINRA routes or Redis implementation yet.'
applyTo:
  - '.github/finra-sec-api-patterns.instructions.md'
---

# FINRA / SEC API pattern guidelines

> Planning note only: this file preserves future-facing data-model and upstream API guidance, but it is not current implementation guidance for `Cosmograph-fs` today.

## Status in `Cosmograph-fs`

This file was imported from another application and is **not active architecture guidance for this repo yet**.

Current verified state of `Cosmograph-fs`:

- The app code lives under `web/`, not `src/` at the repo root.
- There is now a typed UI-facing regulator schema registry at `web/src/lib/regulator-schemas.ts`.
- There are currently **no** FINRA/SEC API routes in this repo.
- There is currently **no** local FINRA entity store, crawler pipeline, or search index.
- There is currently **no** Redis dependency, Redis client, or Redis environment configuration in this repo.
- The current app is a client-rendered force-graph demo, not a FINRA-backed data application.

Treat this file as a **planning note** rather than an active implementation instruction source until the future FINRA/SEC app actually exists in this repo.

## Current regulator schema source of truth

The current repo **does** contain a typed regulator copy/schema layer for UI text and cross-site wording:

- `web/src/lib/regulator-schemas.ts`

Use that file as the source of truth for regulator-specific labels until real FINRA/SEC API-backed models exist.

Current exported types and values:

- `RegulatorId = 'finra' | 'sec'`
- `ScopeLabels`
- `CrossSiteLabels`
- `RegulatorSchema`
- `REGULATOR_SCHEMAS`
- `DEFAULT_REGULATOR_ID`
- `DEFAULT_REGULATOR_SCHEMA`
- `getRegulatorSchema(regulatorId)`

Current default:

- `DEFAULT_REGULATOR_ID` is `finra`
- `web/src/app/layout.tsx` reads `DEFAULT_REGULATOR_SCHEMA.home.title` for page metadata

## Current schema shape

Each `RegulatorSchema` currently includes these sections:

- `home`
  - `title`
- `scope`
  - `firm`
  - `individual`
- `sanctions`
  - `Record<string, string>` containing FINRA and SEC sanction-message copy
- `search-filters`
  - `radius`
  - `experience`
  - `status.active`
  - `status.previous`
  - `status.barred`
  - `employer-search-scope.include`
- `search-results`
  - `barred`
  - `suspended`
  - `limited`
  - `not-registered`
  - `x-site-description`
  - `x-site-destination`
  - `x-site-link-a`
  - `x-site-link-b`
  - `x-site-link-short`
  - `x-site-source`
  - `x-site-tooltip`
- `individual-details-page`
  - same shape as `search-results`

## Current FINRA and SEC schema details

The current schema registry stores two parallel UI-copy definitions:

### FINRA schema

- `home.title`: `BrokerCheck - Find a broker, investment or financial advisor`
- source label in cross-site content: `BrokerCheck`
- cross-site destination in search/detail copy: `SEC Site`
- `search-filters.status.barred`: `Barred/Limited`
- previous-registration abbreviations use `PR` for both firm and individual previous-registration labels

### SEC schema

- `home.title`: `IAPD - Investment Adviser Public Disclosure - Homepage`
- source label in cross-site content: `IAPD`
- cross-site destination in search/detail copy: `BrokerCheck`
- `search-filters.status.barred`: `Barred/Limited by FINRA or the SEC`
- previous-registration abbreviations stay aligned to channel labels (`B` / `IA`) instead of `PR`
- `individual-details-page.barred`: `BARRED BY FINRA OR THE SEC`

### Shared details across both schemas

- Both schemas define the same top-level keys and nested structure.
- Both schemas currently carry the same sanction-message key set under `sanctions`.
- Both schemas include cross-site tooltip text describing complaints, arbitrations, regulatory actions, employment terminations, bankruptcies, and judicial proceedings.

## How to maintain schema guidance

When working on future FINRA/SEC integrations, keep these rules aligned with `web/src/lib/regulator-schemas.ts`:

- Do not duplicate regulator copy in route handlers, prompts, or docs if the value already exists in the schema registry.
- If UI wording changes for BrokerCheck or IAPD, update the schema registry first, then update docs/instructions that reference the changed copy.
- If future API normalization introduces strongly typed upstream models, keep `RegulatorSchema` focused on presentation/copy concerns unless the repo intentionally promotes it into a broader domain contract.
- If a future FINRA/SEC app adds server routes, document clearly whether each field comes from:
  - static schema copy in `web/src/lib/regulator-schemas.ts`
  - normalized local data under `web/data/finra/`
  - live upstream FINRA/SEC payloads

## Boundary between schema copy and canonical entity data

The current regulator schema file is **not** a canonical entity data model.

It should currently be treated as:

- UI copy and regulator-label metadata
- search/filter label definitions
- cross-site wording between BrokerCheck and IAPD views
- sanction-message text templates

It should **not** be treated as:

- a person or firm record shape
- an upstream FINRA/SEC response contract
- a replacement for future canonical entity files under `web/data/finra/`
- a Redis cache schema

## Chosen local canonical data structure

When this repo grows into a FINRA/SEC data application, the local source of truth should be a **file-backed normalized dataset** stored with the web app, not Redis.

Preferred location:

- `web/data/finra/`

Recommended structure:

- `web/data/finra/entities/people/<CRD>.json`
  - canonical person record keyed by CRD/source ID
- `web/data/finra/entities/firms/<CRD>.json`
  - canonical firm record keyed by CRD/source ID
- `web/data/finra/relationships/<NODE_ID>.json`
  - adjacency payload for a node, including connected people, firms, and link metadata
- `web/data/finra/search/people-prefix/<TOKEN>.json`
  - compact denormalized records for person search/typeahead
- `web/data/finra/search/firms-prefix/<TOKEN>.json`
  - compact denormalized records for firm search/typeahead
- `web/data/finra/upstream-cache/<SOURCE>/<TYPE>_<ID>.json`
  - optional raw upstream payload snapshots for refresh/debug workflows only

Canonical local records should be normalized enough to support:

- entity lookup by CRD/source ID
- graph expansion by node ID
- one-word search/token lookup
- sidebar summary and expanded detail views without depending on Redis

Redis, if added later, should accelerate this local structure rather than replace it.

## Future activation rule

Only promote this document back into active repo guidance after all of the following are true:

- the local data structure described below has been implemented in real code/data
- real route or loader code exists for FINRA/SEC enrichment
- the cache layer decision has been made and implemented
- the `applyTo` paths have been rewritten to match the actual repo layout

If that future version uses Redis, document Redis as a **cache layer**, not as the primary source of truth for graph entities.

## Cache stance for now

For this repo today, the correct statement is:

- **Redis is not currently configured or required to launch the app.**
- **If Redis is added later, it should exist only on the production server and must remain optional everywhere else.**

Planned deployment stance:

- local development: no Redis required
- preview/test environments: should still boot without Redis unless explicitly enabled
- production: Redis may be enabled as a cache layer only
- cache miss behavior: fall back to the local canonical dataset or upstream fetch/hydration path
- startup behavior: the app must not crash simply because Redis is absent

If Redis is introduced later, document at minimum:

- which package/client is used
- required environment variables
- key naming conventions
- TTL policy
- what data is cached versus persisted as canonical local data

Recommended separation when that work begins:

- canonical local data model: file-backed people, firms, relationships, and search-ready denormalized records under `web/data/finra/`
- Redis cache: hydrated upstream responses, search result windows, and precomputed graph neighborhoods in production only

The local data structure should be decided first; Redis should accelerate it, not define it.

---

The remaining sections below are preserved from the source application for future reuse once this repo has matching functionality.

Those preserved sections may refer to route paths, loaders, or behaviors that do **not** exist in this repository yet. Until the FINRA/SEC app is actually implemented here, treat those references as historical/source-app context rather than current repo facts.

This instruction supplements `.github/copilot-instructions.md` for work that touches upstream FINRA BrokerCheck and SEC AdviserInfo integrations.

## Prefer app-validated endpoint shapes

Use the patterns already validated by this application and its live upstream tests.

### Detail fetches by CRD/source ID

Prefer direct detail endpoints when the goal is to fetch a specific person or firm record:

- Individual detail:
  - `https://api.brokercheck.finra.org/search/individual/<CRD>?hl=true&wt=json`
  - `https://api.adviserinfo.sec.gov/search/individual/<CRD>?wt=json`
- Expanded individual detail with previous registrations:
  - `https://api.brokercheck.finra.org/search/individual/<CRD>?hl=true&includePrevious=true&nrows=<NROWS>&r=<R>&sort=bc_lastname_sort+asc,bc_firstname_sort+asc,bc_middlename_sort+asc,score+desc&wt=json`
  - `https://api.adviserinfo.sec.gov/search/individual/<CRD>?hl=true&includePrevious=true&nrows=<NROWS>&r=<R>&sort=bc_lastname_sort+asc,bc_firstname_sort+asc,bc_middlename_sort+asc,score+desc&wt=json`
- Firm detail:
  - `https://api.brokercheck.finra.org/search/firm/<CRD>?hl=true&wt=json`
  - `https://api.adviserinfo.sec.gov/search/firm/<CRD>?wt=json`
- Expanded firm detail:
  - `https://api.brokercheck.finra.org/search/firm/<CRD>?hl=true&nrows=<NROWS>&query=<QUERY>&start=<START>&wt=json`

For this app, live testing confirmed that the SEC direct firm detail form `search/firm/<CRD>?wt=json` returns structured detail content and should be preferred over a query-by-ID URL when the task is detail hydration.

## Use query endpoints for search, not canonical detail docs

Use free-text or ID-as-query endpoints only for search experiences, search proxies, or crawler seeding:

- FINRA free-text search:
  - `https://api.brokercheck.finra.org/search/individual?query=<QUERY>&hl=true&wt=json&nrows=<NROWS>&start=<START>`
  - `https://api.brokercheck.finra.org/search/firm?query=<QUERY>&hl=true&wt=json&nrows=<NROWS>&start=<START>`
- SEC free-text search:
  - `https://api.adviserinfo.sec.gov/search/individual?query=<QUERY>&hl=true&wt=json&nrows=<NROWS>&start=<START>`
  - `https://api.adviserinfo.sec.gov/search/firm?query=<QUERY>&hl=true&wt=json&nrows=<NROWS>&start=<START>`
- AdviserInfo firm-prefix search used by this codebase:
  - `https://api.adviserinfo.sec.gov/search/individual?firm=<FIRM_PREFIX>`

Do not document `query=<numeric id>` as the preferred SEC firm detail pattern unless you are explicitly describing a search or seeding workflow. In this repo, `query=<CRD>` may return hit lists or multiple matches because the same number can match different identifier fields, while direct `search/firm/<CRD>` is the better detail-fetch reference.

## Use placeholders, not baked-in examples

When writing docs, prompts, or instructions:

- Prefer placeholders such as `<CRD>`, `<QUERY>`, `<NROWS>`, `<START>`, and `<R>`.
- Do not bake in misleading examples like `query=smith` unless the example is intentionally demonstrating a human search term.
- Use `https` in examples unless documenting a specific legacy compatibility case.

Placeholder meanings:

- `<CRD>`: individual or firm CRD / source identifier
- `<QUERY>`: free-text term or blank string where the upstream endpoint supports it
- `<NROWS>`: result window size
- `<START>`: pagination offset
- `<R>`: upstream ranking/window parameter
- `<FIRM_PREFIX>`: adviser firm-name prefix used by SEC individual search-by-firm flows

## Treat preserved route defaults as source-app context

When adding or editing future route helpers, treat these preserved defaults as source-app context to reuse only if the future implementation intentionally adopts them:

- `hl=true`
- `wt=json`
- ignore hard-coded `nrows=12` values that appear in preserved query-string examples unless the future implementation explicitly adopts that window size
- `start=0` for search routes
- `includePrevious=true` for individual detail enrichment unless intentionally disabled

If that future implementation changes defaults, update both:

- runtime route code under the eventual FINRA route location (preserved here as `src/app/api/finra/**` from the source app)
- any docs or instruction files that mention those endpoint shapes

## Cache naming must match repo convention

When generating or documenting cached upstream payloads, use filenames that match the existing convention:

- `api.brokercheck.finra.org_search_individual_<CRD>.json`
- `api.adviserinfo.sec.gov_search_individual_<CRD>.json`
- `api.brokercheck.finra.org_search_firm_<CRD>.json`
- `api.adviserinfo.sec.gov_search_firm_<CRD>.json`

Avoid inventing alternate naming schemes in docs or scripts unless the task explicitly includes a migration.

## Verify before updating docs or prompts

Before changing endpoint guidance in `.github/copilot-instructions.md`, `.github/SKILL.md`, `README.md`, or future API proxy code:

- compare the proposed URL shape against the current route implementation in the actual repo path that owns FINRA routes (preserved here as `src/app/api/finra/**` from the source app)
- prefer the pattern already used by the app unless live testing or the task proves a better replacement
- if route code and docs differ, fix the mismatch instead of copying the stale form forward

## Keep functional docs strictly aligned with the current working state

When updating `README.md`, repo instruction files, or prompts that describe graph functionality:

- treat the current runtime implementation as the source of truth
- validate behavior against the relevant code paths before documenting it
- avoid documenting intended behavior unless that behavior is already implemented and verified

For graph interaction changes in the future FINRA/SEC application, validate against:

- the eventual graph state/path module (preserved here as `src/lib/finra-graph.ts` from the source app)
- the eventual app stylesheet location (preserved here as `src/app/globals.css` from the source app)
- the current working browser state when the task depends on visible interaction behavior

This is especially important for:

- trace-mode semantics
- selection and highlight behavior
- sidebar and selection-log interactions
- any statement about what colors, rings, or path overlays mean

If the implementation and docs disagree, update the docs to match the verified current behavior unless the task explicitly requires changing the implementation too.

## Good examples

- Good: “Use `https://api.adviserinfo.sec.gov/search/firm/<CRD>?wt=json` for SEC firm detail hydration.”
- Good: “Use `https://api.adviserinfo.sec.gov/search/firm?query=<QUERY>&hl=true&wt=json&nrows=<NROWS>&start=<START>` for firm search.”
- Avoid: “Use `https://api.adviserinfo.sec.gov/search/firm/<CRD>?hl=true&nrows=12&query=smith&r=25&sort=score+desc&wt=json`” as a generic canonical example; the hard-coded `nrows=12` query value in preserved source examples should be ignored unless a future implementation intentionally keeps it.
