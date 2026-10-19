#!/usr/bin/env node

import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

loadDotEnv(resolve(".env"));

const env = process.env;

const SUPABASE_URL = cleanUrl(env.SUPABASE_URL);
const SUPABASE_KEY = env.SUPABASE_KEY || env.SUPABASE_ANON_KEY || env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY;
const SUPABASE_AUTH_TOKEN = env.SUPABASE_AUTH_TOKEN || "";
const SUPABASE_SCHEMA = env.SUPABASE_SCHEMA || "public";
const TABLES = parseList(env.TABLES);
const EXCLUDE_TABLES = new Set(parseList(env.EXCLUDE_TABLES));
const PAGE_SIZE = parseIntEnv("PAGE_SIZE", 1000);
const COUNT_MODE = (env.COUNT_MODE || "none").toLowerCase();
const OUTPUT_DIR = resolve(env.OUTPUT_DIR || `supabase-export-${timestampForPath()}`);
const STOP_ON_ERROR = parseBool(env.STOP_ON_ERROR, false);

if (!SUPABASE_URL || !SUPABASE_KEY) {
  fail(`Variaveis obrigatorias ausentes.

Defina:
  SUPABASE_URL=https://<project-ref>.supabase.co
  SUPABASE_KEY=<anon|publishable|service_role|secret>

Opcional:
  SUPABASE_AUTH_TOKEN=<jwt-de-usuario-logado>
  TABLES=table1,table2
  EXCLUDE_TABLES=table3,table4
  SUPABASE_SCHEMA=public
  OUTPUT_DIR=./backup
  PAGE_SIZE=1000
  COUNT_MODE=none|exact|planned|estimated`);
}

if (PAGE_SIZE < 1 || PAGE_SIZE > 10000) {
  fail("PAGE_SIZE deve ficar entre 1 e 10000.");
}

if (!["none", "exact", "planned", "estimated"].includes(COUNT_MODE)) {
  fail("COUNT_MODE deve ser none, exact, planned ou estimated.");
}

mkdirSync(OUTPUT_DIR, { recursive: true });

const manifest = {
  startedAt: new Date().toISOString(),
  supabaseUrl: SUPABASE_URL,
  schema: SUPABASE_SCHEMA,
  outputDir: OUTPUT_DIR,
  pageSize: PAGE_SIZE,
  countMode: COUNT_MODE,
  authMode: SUPABASE_AUTH_TOKEN ? "apikey + user jwt" : "apikey as bearer",
  tables: [],
  errors: [],
  warnings: [
    "Export API-only: respeita grants/RLS quando usado com anon/publishable ou JWT de usuario.",
    "Nao e equivalente a pg_dump: nao exporta schema SQL completo, triggers, policies, grants, indexes, auth internals nem snapshot transacional.",
  ],
};

main().catch((error) => {
  manifest.finishedAt = new Date().toISOString();
  manifest.fatalError = normalizeError(error);
  writeManifest(manifest);
  console.error(`\nFalha fatal: ${error.message}`);
  process.exit(1);
});

async function main() {
  console.log("Supabase API export");
  console.log(`URL: ${SUPABASE_URL}`);
  console.log(`Schema: ${SUPABASE_SCHEMA}`);
  console.log(`Output: ${OUTPUT_DIR}`);
  console.log(`Count: ${COUNT_MODE}`);
  console.log(`Key: ${redact(SUPABASE_KEY)}`);
  console.log(`Auth: ${SUPABASE_AUTH_TOKEN ? "SUPABASE_AUTH_TOKEN" : "SUPABASE_KEY"}`);

  const tables = TABLES.length > 0 ? TABLES : await discoverTables();
  const selectedTables = tables.filter((table) => !EXCLUDE_TABLES.has(table));

  if (selectedTables.length === 0) {
    fail("Nenhuma tabela encontrada. Defina TABLES=table1,table2 ou confira grants/RLS da API.");
  }

  console.log(`Tabelas: ${selectedTables.join(", ")}`);

  for (const table of selectedTables) {
    const started = Date.now();
    const tableResult = {
      table,
      file: join(OUTPUT_DIR, `${safeFileName(table)}.jsonl`),
      rows: 0,
      pages: 0,
      ok: false,
      startedAt: new Date().toISOString(),
    };

    try {
      console.log(`\nExportando ${table}...`);
      const result = await exportTable(table, tableResult.file);
      tableResult.rows = result.rows;
      tableResult.pages = result.pages;
      tableResult.ok = true;
      tableResult.finishedAt = new Date().toISOString();
      tableResult.durationMs = Date.now() - started;
      console.log(`OK ${table}: ${tableResult.rows} linhas em ${tableResult.pages} pagina(s)`);
    } catch (error) {
      tableResult.ok = false;
      tableResult.finishedAt = new Date().toISOString();
      tableResult.durationMs = Date.now() - started;
      tableResult.error = normalizeError(error);
      manifest.errors.push({ table, ...tableResult.error });
      console.error(`ERRO ${table}: ${error.message}`);

      if (STOP_ON_ERROR) {
        manifest.tables.push(tableResult);
        throw error;
      }
    }

    manifest.tables.push(tableResult);
    writeManifest(manifest);
  }

  manifest.finishedAt = new Date().toISOString();
  writeManifest(manifest);

  const ok = manifest.tables.filter((table) => table.ok).length;
  const failed = manifest.tables.length - ok;
  console.log(`\nConcluido. Tabelas OK: ${ok}. Falhas: ${failed}.`);
  console.log(`Manifest: ${join(OUTPUT_DIR, "manifest.json")}`);

  if (failed > 0) {
    process.exitCode = 2;
  }
}

async function discoverTables() {
  console.log("\nDescobrindo tabelas pelo OpenAPI da REST API...");

  const response = await fetch(`${SUPABASE_URL}/rest/v1/`, {
    method: "GET",
    headers: {
      ...baseHeaders(),
      Accept: "application/openapi+json",
    },
  });

  if (!response.ok) {
    const body = await safeText(response);
    fail(`Nao consegui descobrir tabelas via OpenAPI (${response.status}). Defina TABLES manualmente.
Resposta: ${body}`);
  }

  const spec = await response.json();
  const paths = spec.paths || {};

  return Object.keys(paths)
    .filter((path) => path.startsWith("/") && !path.startsWith("/rpc/"))
    .map((path) => decodeURIComponent(path.slice(1)))
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
}

async function exportTable(table, outputFile) {
  const stream = createWriteStream(outputFile, { encoding: "utf8" });
  let offset = 0;
  let rows = 0;
  let pages = 0;

  try {
    while (true) {
      const from = offset;
      const to = offset + PAGE_SIZE - 1;
      const url = new URL(`${SUPABASE_URL}/rest/v1/${encodeURIComponent(table)}`);
      url.searchParams.set("select", "*");

      const headers = {
        ...baseHeaders(),
        Range: `${from}-${to}`,
        "Range-Unit": "items",
      };

      if (COUNT_MODE !== "none") {
        headers.Prefer = `count=${COUNT_MODE}`;
      }

      const response = await fetch(url, {
        method: "GET",
        headers,
      });

      if (!response.ok && response.status !== 206) {
        const body = await safeText(response);
        throw new Error(`HTTP ${response.status}: ${body}`);
      }

      const page = await response.json();
      if (!Array.isArray(page)) {
        throw new Error(`Resposta inesperada para ${table}: esperado array JSON.`);
      }

      for (const row of page) {
        stream.write(`${JSON.stringify(row)}\n`);
      }

      rows += page.length;
      pages += 1;
      offset += PAGE_SIZE;

      const range = response.headers.get("content-range") || "";
      process.stdout.write(`  ${table}: ${rows} linhas\r`);

      if (page.length < PAGE_SIZE || isLastRange(range)) {
        break;
      }
    }
  } finally {
    await closeStream(stream);
  }

  process.stdout.write("\n");
  return { rows, pages };
}

function baseHeaders() {
  return {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_AUTH_TOKEN || SUPABASE_KEY}`,
    "Accept-Profile": SUPABASE_SCHEMA,
  };
}

function isLastRange(contentRange) {
  const match = contentRange.match(/^(\d+)-(\d+)\/(\d+|\*)$/);
  if (!match || match[3] === "*") {
    return false;
  }

  return Number(match[2]) + 1 >= Number(match[3]);
}

function closeStream(stream) {
  return new Promise((resolveClose, rejectClose) => {
    stream.end((error) => {
      if (error) rejectClose(error);
      else resolveClose();
    });
  });
}

function writeManifest(data) {
  writeFileSync(join(OUTPUT_DIR, "manifest.json"), `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function loadDotEnv(filePath) {
  if (!existsSync(filePath)) {
    return;
  }

  const content = readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) {
      continue;
    }

    const [, key, rawValue] = match;
    if (process.env[key] !== undefined) {
      continue;
    }

    process.env[key] = parseDotEnvValue(rawValue);
  }
}

function parseDotEnvValue(rawValue) {
  let value = rawValue.trim();
  const quote = value[0];

  if ((quote === "\"" || quote === "'") && value.endsWith(quote)) {
    value = value.slice(1, -1);
  }

  if (quote === "\"") {
    value = value
      .replace(/\\n/g, "\n")
      .replace(/\\r/g, "\r")
      .replace(/\\t/g, "\t")
      .replace(/\\"/g, "\"")
      .replace(/\\\\/g, "\\");
  }

  return value;
}

function cleanUrl(value) {
  if (!value) return "";
  return value.replace(/\/+$/, "");
}

function parseList(value) {
  return (value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseBool(value, fallback) {
  if (value === undefined || value === "") return fallback;
  return ["1", "true", "yes", "sim", "s"].includes(String(value).toLowerCase());
}

function parseIntEnv(name, fallback) {
  const value = env[name];
  if (!value) return fallback;

  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    fail(`${name} precisa ser numero inteiro.`);
  }

  return parsed;
}

function timestampForPath() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function safeFileName(value) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "_");
}

function redact(value) {
  if (!value) return "";
  if (value.length <= 12) return "***";
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function normalizeError(error) {
  return {
    message: error.message,
    name: error.name,
    stack: error.stack,
  };
}

async function safeText(response) {
  const text = await response.text();
  return text.length > 2000 ? `${text.slice(0, 2000)}...` : text;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
