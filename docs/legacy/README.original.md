> Historical project notes. Paths, operational status, badges and test claims below are retained as archival reference and have not all been revalidated. Use the root README and docs/REVIEW.md for this review snapshot.

# Supabase API Export

Exportador local via Supabase REST API. Ele funciona com `anon`/`publishable`,
`service_role` ou `secret key`, sem connection string Postgres.

Limite importante: isso nao e `pg_dump`. Via API ele exporta linhas de tabelas
expostas pela REST API. Com `anon`/`publishable`, respeita grants e RLS. Com
`service_role`/`secret`, roda server-side/local e pode bypassar RLS. Nao exporta
schema SQL completo, triggers, policies, grants, indexes, roles, extensions nem
snapshot transacional.

## Uso rapido no PowerShell

Opcao A: coloque um arquivo `.env` no mesmo diretorio:

```dotenv
SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
SUPABASE_KEY=YOUR_SUPABASE_KEY
```

Depois rode:

```powershell
node .\export-supabase-api.mjs
```

Opcao B: defina no PowerShell:

```powershell
$env:SUPABASE_URL="https://YOUR_PROJECT_REF.supabase.co"
$env:SUPABASE_KEY="YOUR_SUPABASE_KEY"
node .\export-supabase-api.mjs
```

Saida:

- `supabase-export-*/<tabela>.jsonl`
- `supabase-export-*/manifest.json`

Por padrao, `COUNT_MODE=none` evita `count=exact` na REST API para reduzir
timeout em tabelas grandes. Se voce realmente quiser contagem exata pelo
PostgREST, defina `COUNT_MODE=exact`.

## Comparar dois exports

```powershell
node .\compare-supabase-exports.mjs .\supabase-export .\supabase-export-2026-07-20 .\supabase-diff-2026-07-20
```

Saida:

- `summary.txt`
- `comparison.csv`
- `comparison.json`

## Exportar tabelas especificas

```powershell
$env:SUPABASE_URL="https://YOUR_PROJECT_REF.supabase.co"
$env:SUPABASE_KEY="YOUR_ANON_OR_SERVICE_KEY"
$env:TABLES="profiles,orders,products"
$env:OUTPUT_DIR=".\backup-api"
node .\export-supabase-api.mjs
```

## Exportar usando anon + JWT de usuario

Use quando as policies dependem do usuario logado.

```powershell
$env:SUPABASE_URL="https://YOUR_PROJECT_REF.supabase.co"
$env:SUPABASE_KEY="YOUR_ANON_OR_PUBLISHABLE_KEY"
$env:SUPABASE_AUTH_TOKEN="USER_ACCESS_TOKEN_JWT"
node .\export-supabase-api.mjs
```

## Chave recomendada por objetivo

- `anon`/`publishable`: seguro para dados publicos ou dados permitidos por RLS.
- `anon`/`publishable` + `SUPABASE_AUTH_TOKEN`: dados permitidos para aquele usuario.
- `service_role` legado ou `secret key` nova: melhor para backup API-only local,
  mas trate como segredo. Nao use em frontend e nao commite.

Para backup completo real do Postgres, use `pg_dump` com a connection string da
DB. Este script existe para o caso em que voce quer ficar estritamente na API.
