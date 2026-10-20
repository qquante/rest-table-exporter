# REST Table Exporter

A Node.js toolkit for exporting exposed Supabase REST table rows and comparing local exports.

## Features

- Offset and keyset export paths support different collection requirements.
- Manifests record export progress and source parameters.
- Comparison tooling identifies table and row-level export differences.

## Stack

JavaScript ES modules · Node.js · native fetch · Supabase/PostgREST REST API · JSONL/CSV

Remote exposed tables are read through REST; local files contain exports, manifests and comparisons. Existing real exports are excluded.

## Getting started

Use a Node.js runtime with native fetch. Review the scripts' environment variables; begin with local comparison fixtures rather than a real service-role credential.

## How it works

```text
Authorized REST endpoint → paginated table rows → JSONL/manifests → local export comparison
```

## Current limitations

This is not pg_dump: it does not export full SQL schema, policies, triggers, roles or a transactional snapshot. Service credentials can bypass RLS and must remain local. No database export was run.

## License

Project-authored source code is licensed under the [MIT License](LICENSE). Third-party components and datasets retain their respective rights and licenses.
