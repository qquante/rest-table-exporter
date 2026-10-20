# REST Table Exporter

![Language: JavaScript](https://img.shields.io/badge/Language-JavaScript-F7DF1E?style=flat-square&logo=javascript) ![Format: JSONL](https://img.shields.io/badge/Format-JSONL-555555?style=flat-square) [![License: MIT](https://img.shields.io/badge/License-MIT-555555?style=flat-square)](LICENSE)

Three standalone Node.js scripts for exporting Supabase/PostgREST table rows and comparing two local exports. No npm dependencies or package installation are required.

## Choose the pagination strategy

| Script | When to use it |
| --- | --- |
| [export-supabase-api.mjs](export-supabase-api.mjs) | General REST export path. |
| [export-supabase-keyset.mjs](export-supabase-keyset.mjs) | One table paginated by an explicit stable ordering column. |
| [compare-supabase-exports.mjs](compare-supabase-exports.mjs) | Compare existing export manifests and file hashes offline. |

The keyset exporter orders ascending and requests values greater than the last observed key. `ORDER_COLUMN` must have suitable uniqueness/stability: a non-unique cursor can skip rows, and ongoing writes can affect export consistency. Streaming writes respect backpressure; manifests retain page/row counts and whether the export completed.

## Configuration for your own database

The scripts load a local `.env`. For the keyset path, set these inputs locally:

```dotenv
SUPABASE_URL=https://example-project.supabase.co
SUPABASE_KEY=YOUR_LOCAL_KEY
TABLE=example_table
ORDER_COLUMN=id
PAGE_SIZE=1000
OUTPUT_DIR=./example-export
```

This is placeholder configuration. `SUPABASE_SCHEMA`, `SELECT` and a separate user auth token are optional. Use only tables you are authorized to export; credentials do not belong in exported manifests or Git.

## Local commands

```console
node --check export-supabase-api.mjs
node --check export-supabase-keyset.mjs
node --check compare-supabase-exports.mjs
```

With local configuration supplied, `node export-supabase-keyset.mjs` starts the network export. To compare two already-created export directories offline:

```console
node compare-supabase-exports.mjs ./older-export ./newer-export ./comparison
```

Comparison records row-count changes, completion state and SHA-256 differences; it is not a semantic row-by-row database diff. Exported data and database access are not bundled, and syntax checks do not establish a transactionally consistent snapshot.

**Technology:** JavaScript ES modules · Node.js · native fetch · Supabase/PostgREST REST API · JSONL/CSV

Project-authored source: [MIT](LICENSE). Third-party components retain their own notices and terms.
