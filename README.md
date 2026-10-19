# REST Table Exporter

> **Local private review:** publication is paused. See [security review and remaining release conditions](docs/SECURITY_REVIEW.md). Local fixes have not been pushed.


A Node.js toolkit for exporting exposed Supabase REST table rows and comparing local exports.

![review](https://img.shields.io/badge/review-private-374151) ![primary](https://img.shields.io/badge/primary-JavaScript-2563EB) [![LinkedIn](https://img.shields.io/badge/LinkedIn-Douglas%20Silva-0A66C2?logo=linkedin&logoColor=white)](https://www.linkedin.com/in/douglas-silva-data-analyst/)

[Overview](#overview) · [Architecture](#architecture) · [Setup](#setup) · [Validation](#validation) · [Roadmap](#roadmap) · [Review notes](docs/REVIEW.md)

## Overview

- Offset and keyset export paths support different collection requirements.
- Manifests record export progress and source parameters.
- Comparison tooling identifies table and row-level export differences.

**Technology:** JavaScript ES modules · Node.js · native fetch · Supabase/PostgREST REST API · JSONL/CSV

**Persistence and data:** Remote exposed tables are read through REST; local files contain exports, manifests and comparisons. Existing real exports are excluded.

## Architecture

```text
Authorized REST endpoint → paginated table rows → JSONL/manifests → local export comparison
```

| Location | Review focus |
| --- | --- |
| [`export-supabase-api.mjs`](export-supabase-api.mjs) | Source/configuration inspected for scope and structure |
| [`export-supabase-keyset.mjs`](export-supabase-keyset.mjs) | Source/configuration inspected for scope and structure |
| [`compare-supabase-exports.mjs`](compare-supabase-exports.mjs) | Source/configuration inspected for scope and structure |

Internal package and module names are retained where changing them would affect imports or compatibility. This descriptive repository name does not imply a completed package/API migration.

## Setup

Use a Node.js runtime with native fetch. Review the scripts' environment variables; begin with local comparison fixtures rather than a real service-role credential.

Start from an isolated environment. Use `.env.example` when present and inspect the configuration loader: an example file is not necessarily loaded automatically. Runtime databases, real account sessions and private credentials are not bundled. Live integration prerequisites are separate from local tests.

## Validation

Static parsing checked 0 Python files and 0 strict JSON files. Python syntax errors: 0; JSON errors: 0. No functional test/build result is claimed for this preparation.

Available test scripts are inventoried in [the review notes](docs/REVIEW.md). Choose offline checks before operating any integration.

These results apply to the selected checks on the preparation copy. They do not establish deployment readiness, full coverage, live provider availability or measured performance. CI definitions, when present under `docs/ci-templates/`, are inactive review templates; no remote CI badge is claimed.

## Limits and current status

This is not pg_dump: it does not export full SQL schema, policies, triggers, roles or a transactional snapshot. Service credentials can bypass RLS and must remain local. No database export was run.

This private snapshot is for code and portfolio review. Generated runtime material and unreviewed binary assets may be excluded. [Review notes](docs/REVIEW.md) record preparation scope, findings and outstanding validation.

## Roadmap

- [ ] Add a mocked PostgREST server and small export fixtures.
- [ ] Document consistency, retry and pagination tradeoffs.
- [ ] Test comparison behavior with duplicates, nulls and reordered rows.

## History and attribution

No recoverable original Git history was verified for this snapshot. Import and preparation commits use their actual current dates; filesystem timestamps are not treated as development dates.

No open-source license is granted by this preparation. A license and attribution review is required before public redistribution.

## Maintainer and feedback

Douglas de Oliveira Silva · [GitHub](https://github.com/qquante) · [LinkedIn](https://www.linkedin.com/in/douglas-silva-data-analyst/)

For this private review, report reproducible issues with a minimal fixture and the exact check output. Keep account data, credentials and generated sensitive reports out of issues and commits. Existing contribution guidelines apply where present.

**Topics:** `javascript`, `nodejs`, `supabase`, `postgrest`, `data-export`, `etl`, `jsonl`
